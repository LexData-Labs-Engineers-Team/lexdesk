import crypto from 'node:crypto';
import { firebaseAdmin } from '../firebase';
import { sql, withTransaction } from '../db';
import { tsToIso, buildInsert, buildUpdateSet } from '../rows';
import { uploadUserPhoto, signedReadUrl, signedReadUrls } from '../storage';
import { FACE_EMBEDDING_MODEL, averageEmbeddings } from './face';
import { verifyFirebasePassword } from '../auth';

// User/employee/profile/face/password operations against Neon Postgres + Firebase
// Auth — ported from AttendDesk. Roles are stored in AttendDesk's vocabulary
// (ADMIN/EMPLOYEE/SUPER_ADMIN) since we share its live data; login maps them to
// LexDesk's lowercase for the JWT. Wrapper shapes match the old HTTP responses.

function newTempPassword() {
  return crypto.randomBytes(8).toString('base64url');
}

async function resolveUid(email) {
  const { auth } = firebaseAdmin();
  const rec = await auth.getUserByEmail(String(email).toLowerCase());
  return rec.uid;
}

// Maps a users row (snake_case pg columns) to the API/JSON contract shape.
function userRow(row, photoUrl) {
  return {
    id: row.firebase_uid,
    email: row.email,
    name: row.name,
    role: row.role,
    teamId: row.team_id ?? null,
    teamName: row.team_name ?? null,
    employeeId: row.employee_id ?? null,
    designation: row.designation ?? null,
    department: row.department ?? null,
    contactNumber: row.contact_number ?? null,
    birthDate: row.birth_date ?? null,
    joiningDate: row.joining_date ?? null,
    mustChangePassword: row.must_change_password ?? false,
    faceEnrolledAt: tsToIso(row.face_enrolled_at),
    createdAt: tsToIso(row.created_at),
    photoUrl: photoUrl ?? null,
    // Login device cap + per-employee IP allowlist (see services/loginGuard.js).
    loginDevices: (row.login_devices || []).map((d) => ({
      deviceId: d.deviceId,
      name: d.name ?? null,
      platform: d.platform ?? null,
      firstSeenAt: d.firstSeenAt ?? null,
      lastSeenAt: d.lastSeenAt ?? null,
    })),
    loginIpAllowlist: row.login_ip_allowlist || [],
  };
}

// signPhotos:false skips the org-wide signed-URL work and instead returns each
// row's raw photoStoragePath, so a caller that only needs photos for a subset
// (e.g. one team) can sign just those. Default keeps the original behavior.
export async function getEmployees(orgId, { signPhotos = true } = {}) {
  const rows = await sql`SELECT * FROM users WHERE org_id=${orgId} ORDER BY created_at DESC`;
  if (!signPhotos) {
    return {
      employees: rows.map((r) => ({
        ...userRow(r, null),
        photoStoragePath: r.photo_storage_path ?? null,
      })),
    };
  }
  const photoUrls = await signedReadUrls(rows.map((r) => r.photo_storage_path));
  return { employees: rows.map((r, i) => userRow(r, photoUrls[i])) };
}

export async function getEmployee(uid, orgId) {
  const rows = await sql`SELECT * FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  if (!rows.length) throw Object.assign(new Error('not_found'), { status: 404 });
  const row = rows[0];
  const photoUrl = await signedReadUrl(row.photo_storage_path);
  return { employee: userRow(row, photoUrl) };
}

// body: { email, name, role: 'ADMIN'|'EMPLOYEE', teamId?, employeeId?,
//         designation?, department?, contactNumber?, birthDate?, joiningDate? }
export async function createEmployee(body, orgId) {
  const { auth } = firebaseAdmin();
  const email = String(body.email).toLowerCase();
  const tempPassword = newTempPassword();
  let record;
  try {
    record = await auth.createUser({ email, password: tempPassword, displayName: body.name, emailVerified: false });
  } catch (err) {
    if (err?.code === 'auth/email-already-exists') {
      throw Object.assign(new Error('A user with that email already exists'), { status: 409 });
    }
    throw err;
  }
  await auth.setCustomUserClaims(record.uid, { role: body.role, orgId, email });

  let teamId = body.teamId ?? null;
  let teamName = null;
  if (teamId) {
    const teamRows = await sql`SELECT name FROM teams WHERE id=${teamId} AND org_id=${orgId}`;
    if (teamRows.length) teamName = teamRows[0].name ?? null;
    else teamId = null;
  }

  const { text, params } = buildInsert('users', {
    firebaseUid: record.uid,
    orgId,
    email,
    name: body.name,
    role: body.role,
    teamId,
    teamName,
    employeeId: body.employeeId ?? null,
    designation: body.designation ?? null,
    department: body.department ?? null,
    contactNumber: body.contactNumber ?? null,
    birthDate: body.birthDate ?? null,
    joiningDate: body.joiningDate ?? null,
    mustChangePassword: true,
    faceEmbeddingB64: null,
    faceEmbeddingModel: null,
    faceEnrolledAt: null,
  });
  await sql.query(text, params);

  return {
    employee: { uid: record.uid, email, name: body.name, role: body.role, temporaryPassword: tempPassword },
  };
}

export async function setEmployeeTeam(uid, teamId, orgId) {
  const existing = await sql`SELECT firebase_uid FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  if (!existing.length) throw Object.assign(new Error('not_found'), { status: 404 });
  let resolvedTeamId = teamId || null;
  let teamName = null;
  if (resolvedTeamId) {
    const teamRows = await sql`SELECT name FROM teams WHERE id=${resolvedTeamId} AND org_id=${orgId}`;
    if (!teamRows.length) throw Object.assign(new Error('team_not_found'), { status: 404 });
    teamName = teamRows[0].name ?? null;
  } else {
    resolvedTeamId = null;
  }
  await sql`UPDATE users SET team_id=${resolvedTeamId}, team_name=${teamName} WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  return { ok: true, teamId: resolvedTeamId, teamName };
}

// Edit a member's basic profile fields (name, employeeId, designation,
// department, contactNumber, birthDate, joiningDate). Email/role/team are
// intentionally excluded here — those are identity/structure changes handled by
// dedicated flows. Keeps the Firebase Auth displayName in sync when name changes.
export async function updateEmployee(
  uid,
  { name, employeeId, designation, department, contactNumber, birthDate, joiningDate } = {},
  orgId,
) {
  const { auth } = firebaseAdmin();
  const existing = await sql`SELECT firebase_uid FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  if (!existing.length) throw Object.assign(new Error('not_found'), { status: 404 });

  const updates = {};
  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (employeeId !== undefined) updates.employeeId = String(employeeId || '').trim() || null;
  if (designation !== undefined) updates.designation = String(designation || '').trim() || null;
  if (department !== undefined) updates.department = String(department || '').trim() || null;
  if (contactNumber !== undefined) updates.contactNumber = String(contactNumber || '').trim() || null;
  if (birthDate !== undefined) updates.birthDate = String(birthDate || '').trim() || null;
  if (joiningDate !== undefined) updates.joiningDate = String(joiningDate || '').trim() || null;
  if (Object.keys(updates).length === 0) return { ok: true };

  const { setClause, params, nextIndex } = buildUpdateSet(updates);
  await sql.query(
    `UPDATE users SET ${setClause} WHERE firebase_uid=$${nextIndex} AND org_id=$${nextIndex + 1}`,
    [...params, uid, orgId],
  );
  if (updates.name) {
    try { await auth.updateUser(uid, { displayName: updates.name }); } catch { /* non-fatal */ }
  }
  return { ok: true, ...updates };
}

// Assign/clear the IT Team role. Restricted to toggling between EMPLOYEE and
// IT_TEAM — it never elevates to (or demotes) ADMIN/SUPER_ADMIN, which are
// provisioned through their own dedicated flows. Updates the user row and the
// Firebase custom claims so both agree. The LexDesk session JWT carries the role
// from login, so the change takes effect when the user next signs in.
const ASSIGNABLE_ROLES = new Set(['EMPLOYEE', 'IT_TEAM', 'DEV']);

export async function setEmployeeRole(uid, role, orgId) {
  const next = String(role || '').toUpperCase();
  if (!ASSIGNABLE_ROLES.has(next)) throw Object.assign(new Error('invalid_role'), { status: 400 });
  const { auth } = firebaseAdmin();
  const rows = await sql`SELECT role, email FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  if (!rows.length) throw Object.assign(new Error('not_found'), { status: 404 });
  const current = String(rows[0].role || '').toUpperCase();
  if (current === 'ADMIN' || current === 'SUPER_ADMIN') {
    throw Object.assign(new Error('cannot_change_admin_role'), { status: 403 });
  }
  const email = rows[0].email ?? '';
  await sql`UPDATE users SET role=${next} WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  try {
    await auth.setCustomUserClaims(uid, { role: next, orgId, email });
    await auth.revokeRefreshTokens(uid);
  } catch { /* claims are best-effort; the stored role is the source of truth at login */ }
  return { ok: true, role: next };
}

export async function deleteEmployee(uid, orgId) {
  const { auth } = firebaseAdmin();
  const existing = await sql`SELECT firebase_uid FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  if (!existing.length) throw Object.assign(new Error('not_found'), { status: 404 });
  await auth.deleteUser(uid);
  await sql`DELETE FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  return { ok: true };
}

export async function resetUserPassword(email, orgId) {
  const { auth } = firebaseAdmin();
  const uid = await resolveUid(email);
  const existing = await sql`SELECT firebase_uid FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  if (!existing.length) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const tempPassword = newTempPassword();
  await auth.updateUser(uid, { password: tempPassword });
  await auth.revokeRefreshTokens(uid);
  await sql`UPDATE users SET must_change_password=true WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  return { email: String(email).toLowerCase(), temporaryPassword: tempPassword };
}

// One-time enroll: 409 if the user already has an embedding (admin reset clears it).
export async function enrollFace(uid, embeddings, orgId) {
  const faceEmbeddingB64 = averageEmbeddings(embeddings);
  const outcome = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT face_embedding_b64, face_enrolled_at FROM users WHERE firebase_uid=$1 AND org_id=$2 FOR UPDATE',
      [uid, orgId],
    );
    if (!rows.length) return { status: 404 };
    if (rows[0].face_embedding_b64) {
      return { status: 409, enrolledAt: tsToIso(rows[0].face_enrolled_at) };
    }
    await client.query(
      'UPDATE users SET face_embedding_b64=$1, face_embedding_model=$2, face_enrolled_at=now() WHERE firebase_uid=$3 AND org_id=$4',
      [faceEmbeddingB64, FACE_EMBEDDING_MODEL, uid, orgId],
    );
    return { status: 200 };
  });
  if (outcome.status === 404) throw Object.assign(new Error('not_found'), { status: 404 });
  if (outcome.status === 409) {
    throw Object.assign(new Error('already_enrolled'), {
      status: 409,
      body: { error: 'already_enrolled', enrolledAt: outcome.enrolledAt },
    });
  }
  return { ok: true, enrolledAt: new Date().toISOString() };
}

// Mobile enroll: OVERWRITE the user's face (re-enroll allowed), unlike the
// web one-time enrollFace. Averages the capture embeddings and stores them.
export async function enrollFaceOverwrite(uid, embeddings, orgId) {
  const faceEmbeddingB64 = averageEmbeddings(embeddings);
  await sql`UPDATE users SET face_embedding_b64=${faceEmbeddingB64}, face_embedding_model=${FACE_EMBEDDING_MODEL}, face_enrolled_at=now() WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  return { ok: true, enrolledAt: new Date().toISOString() };
}

export async function resetFace(uid, orgId) {
  const rows = await sql`SELECT face_embedding_b64 FROM users WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  if (!rows.length) throw Object.assign(new Error('not_found'), { status: 404 });
  const wasEnrolled = !!rows[0].face_embedding_b64;
  await sql`UPDATE users SET face_embedding_b64=NULL, face_embedding_model=NULL, face_enrolled_at=NULL WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  return { ok: true, wasEnrolled };
}

export async function updateName(email, name, orgId) {
  const { auth } = firebaseAdmin();
  const uid = await resolveUid(email);
  await auth.updateUser(uid, { displayName: name });
  await sql`UPDATE users SET name=${name} WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  return { ok: true, name };
}

const ALLOWED_PHOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export async function uploadPhoto(email, dataUrl, orgId) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(dataUrl).trim());
  if (!m) throw Object.assign(new Error('invalid_image'), { status: 400 });
  const contentType = m[1].toLowerCase();
  if (!ALLOWED_PHOTO.has(contentType)) throw Object.assign(new Error('unsupported_type'), { status: 415 });
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length <= 0 || bytes.length > MAX_PHOTO_BYTES) {
    throw Object.assign(new Error('file_too_large'), { status: 413 });
  }
  const uid = await resolveUid(email);
  const { storagePath } = await uploadUserPhoto(orgId, uid, bytes, contentType);
  await sql`UPDATE users SET photo_storage_path=${storagePath}, photo_updated_at=now() WHERE firebase_uid=${uid} AND org_id=${orgId}`;
  return { ok: true, photoUrl: await signedReadUrl(storagePath) };
}

export async function changePassword(email, currentPassword, newPassword) {
  const ok = await verifyFirebasePassword(email, currentPassword);
  if (!ok) throw Object.assign(new Error('Current password is incorrect'), { status: 400 });
  const { auth } = firebaseAdmin();
  const uid = await resolveUid(email);
  await auth.updateUser(uid, { password: newPassword });
  await auth.revokeRefreshTokens(uid);
  return { ok: true };
}

export async function writeAuditLog(orgId, actorUid, action, targetId, metadata) {
  const { text, params } = buildInsert(
    'audit_logs',
    {
      orgId,
      actorUid,
      action,
      targetId,
      metadata: metadata ?? null,
    },
    { jsonbKeys: ['metadata'] },
  );
  await sql.query(text, params);
}
