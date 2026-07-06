import crypto from 'node:crypto';
import { firebaseAdmin, FieldValue } from '../firebase';
import { Paths } from '../paths';
import { uploadUserPhoto, signedReadUrl, signedReadUrls } from '../storage';
import { FACE_EMBEDDING_MODEL, averageEmbeddings } from './face';
import { verifyFirebasePassword } from '../auth';

// User/employee/profile/face/password operations against Firestore + Firebase
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

function userRow(id, data, photoUrl) {
  return {
    id,
    email: data.email,
    name: data.name,
    role: data.role,
    teamId: data.teamId ?? null,
    teamName: data.teamName ?? null,
    employeeId: data.employeeId ?? null,
    designation: data.designation ?? null,
    department: data.department ?? null,
    contactNumber: data.contactNumber ?? null,
    birthDate: data.birthDate ?? null,
    joiningDate: data.joiningDate ?? null,
    mustChangePassword: data.mustChangePassword ?? false,
    faceEnrolledAt: data.faceEnrolledAt?.toDate?.()?.toISOString() ?? null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    photoUrl: photoUrl ?? null,
    // Login device cap + per-employee IP allowlist (see services/loginGuard.js).
    loginDevices: (data.loginDevices || []).map((d) => ({
      deviceId: d.deviceId,
      name: d.name ?? null,
      platform: d.platform ?? null,
      firstSeenAt: d.firstSeenAt ?? null,
      lastSeenAt: d.lastSeenAt ?? null,
    })),
    loginIpAllowlist: data.loginIpAllowlist || [],
  };
}

// signPhotos:false skips the org-wide signed-URL work and instead returns each
// row's raw photoStoragePath, so a caller that only needs photos for a subset
// (e.g. one team) can sign just those. Default keeps the original behavior.
export async function getEmployees(orgId, { signPhotos = true } = {}) {
  const { db } = firebaseAdmin();
  const snap = await db.collection(Paths.users(orgId)).orderBy('createdAt', 'desc').get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  if (!signPhotos) {
    return {
      employees: docs.map((d) => ({
        ...userRow(d.id, d.data, null),
        photoStoragePath: d.data.photoStoragePath ?? null,
      })),
    };
  }
  const photoUrls = await signedReadUrls(docs.map((d) => d.data.photoStoragePath));
  return { employees: docs.map((d, i) => userRow(d.id, d.data, photoUrls[i])) };
}

export async function getEmployee(uid, orgId) {
  const { db } = firebaseAdmin();
  const snap = await db.doc(Paths.user(orgId, uid)).get();
  if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
  const data = snap.data();
  const photoUrl = await signedReadUrl(data.photoStoragePath);
  return { employee: userRow(snap.id, data, photoUrl) };
}

// body: { email, name, role: 'ADMIN'|'EMPLOYEE', teamId?, employeeId?,
//         designation?, department?, contactNumber?, birthDate?, joiningDate? }
export async function createEmployee(body, orgId) {
  const { auth, db } = firebaseAdmin();
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
    const teamSnap = await db.doc(Paths.team(orgId, teamId)).get();
    if (teamSnap.exists) teamName = teamSnap.data()?.name ?? null;
    else teamId = null;
  }

  const batch = db.batch();
  batch.set(db.doc(Paths.user(orgId, record.uid)), {
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
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(Paths.userIndex(record.uid)), { orgId, role: body.role, email });
  await batch.commit();

  return {
    employee: { uid: record.uid, email, name: body.name, role: body.role, temporaryPassword: tempPassword },
  };
}

export async function setEmployeeTeam(uid, teamId, orgId) {
  const { db } = firebaseAdmin();
  const userRef = db.doc(Paths.user(orgId, uid));
  const snap = await userRef.get();
  if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
  let resolvedTeamId = teamId || null;
  let teamName = null;
  if (resolvedTeamId) {
    const teamSnap = await db.doc(Paths.team(orgId, resolvedTeamId)).get();
    if (!teamSnap.exists) throw Object.assign(new Error('team_not_found'), { status: 404 });
    teamName = teamSnap.data()?.name ?? null;
  } else {
    resolvedTeamId = null;
  }
  await userRef.update({ teamId: resolvedTeamId, teamName });
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
  const { auth, db } = firebaseAdmin();
  const ref = db.doc(Paths.user(orgId, uid));
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });

  const updates = {};
  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (employeeId !== undefined) updates.employeeId = String(employeeId || '').trim() || null;
  if (designation !== undefined) updates.designation = String(designation || '').trim() || null;
  if (department !== undefined) updates.department = String(department || '').trim() || null;
  if (contactNumber !== undefined) updates.contactNumber = String(contactNumber || '').trim() || null;
  if (birthDate !== undefined) updates.birthDate = String(birthDate || '').trim() || null;
  if (joiningDate !== undefined) updates.joiningDate = String(joiningDate || '').trim() || null;
  if (Object.keys(updates).length === 0) return { ok: true };

  await ref.update(updates);
  if (updates.name) {
    try { await auth.updateUser(uid, { displayName: updates.name }); } catch { /* non-fatal */ }
  }
  return { ok: true, ...updates };
}

// Assign/clear the IT Team role. Restricted to toggling between EMPLOYEE and
// IT_TEAM — it never elevates to (or demotes) ADMIN/SUPER_ADMIN, which are
// provisioned through their own dedicated flows. Updates the user doc, the
// Firebase custom claims, and the cross-org user index so all three agree. The
// LexDesk session JWT carries the role from login, so the change takes effect
// when the user next signs in.
const ASSIGNABLE_ROLES = new Set(['EMPLOYEE', 'IT_TEAM', 'DEV']);

export async function setEmployeeRole(uid, role, orgId) {
  const next = String(role || '').toUpperCase();
  if (!ASSIGNABLE_ROLES.has(next)) throw Object.assign(new Error('invalid_role'), { status: 400 });
  const { auth, db } = firebaseAdmin();
  const ref = db.doc(Paths.user(orgId, uid));
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
  const data = snap.data() ?? {};
  const current = String(data.role || '').toUpperCase();
  if (current === 'ADMIN' || current === 'SUPER_ADMIN') {
    throw Object.assign(new Error('cannot_change_admin_role'), { status: 403 });
  }
  const email = data.email ?? '';
  await ref.update({ role: next });
  try {
    await auth.setCustomUserClaims(uid, { role: next, orgId, email });
    await auth.revokeRefreshTokens(uid);
  } catch { /* claims are best-effort; the Firestore role is the source of truth at login */ }
  await db.doc(Paths.userIndex(uid)).set({ orgId, role: next, email }, { merge: true });
  return { ok: true, role: next };
}

export async function deleteEmployee(uid, orgId) {
  const { auth, db } = firebaseAdmin();
  const userRef = db.doc(Paths.user(orgId, uid));
  const snap = await userRef.get();
  if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
  await auth.deleteUser(uid);
  const batch = db.batch();
  batch.delete(userRef);
  batch.delete(db.doc(Paths.userIndex(uid)));
  await batch.commit();
  return { ok: true };
}

export async function resetUserPassword(email, orgId) {
  const { auth, db } = firebaseAdmin();
  const uid = await resolveUid(email);
  const userRef = db.doc(Paths.user(orgId, uid));
  const snap = await userRef.get();
  if (!snap.exists) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const tempPassword = newTempPassword();
  await auth.updateUser(uid, { password: tempPassword });
  await auth.revokeRefreshTokens(uid);
  await userRef.update({ mustChangePassword: true });
  return { email: String(email).toLowerCase(), temporaryPassword: tempPassword };
}

// One-time enroll: 409 if the user already has an embedding (admin reset clears it).
export async function enrollFace(uid, embeddings, orgId) {
  const { db } = firebaseAdmin();
  const ref = db.doc(Paths.user(orgId, uid));
  const faceEmbeddingB64 = averageEmbeddings(embeddings);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 404 };
    if (snap.data().faceEmbeddingB64) {
      return { status: 409, enrolledAt: snap.data().faceEnrolledAt?.toDate?.()?.toISOString() ?? null };
    }
    tx.update(ref, { faceEmbeddingB64, faceEmbeddingModel: FACE_EMBEDDING_MODEL, faceEnrolledAt: FieldValue.serverTimestamp() });
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
  const { db } = firebaseAdmin();
  await db.doc(Paths.user(orgId, uid)).update({
    faceEmbeddingB64,
    faceEmbeddingModel: FACE_EMBEDDING_MODEL,
    faceEnrolledAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, enrolledAt: new Date().toISOString() };
}

export async function resetFace(uid, orgId) {
  const { db } = firebaseAdmin();
  const ref = db.doc(Paths.user(orgId, uid));
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
  const wasEnrolled = !!snap.data().faceEmbeddingB64;
  await ref.update({
    faceEmbeddingB64: FieldValue.delete(),
    faceEmbeddingModel: FieldValue.delete(),
    faceEnrolledAt: FieldValue.delete(),
  });
  return { ok: true, wasEnrolled };
}

export async function updateName(email, name, orgId) {
  const { auth, db } = firebaseAdmin();
  const uid = await resolveUid(email);
  await auth.updateUser(uid, { displayName: name });
  await db.doc(Paths.user(orgId, uid)).update({ name });
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
  const { db } = firebaseAdmin();
  const uid = await resolveUid(email);
  const { storagePath } = await uploadUserPhoto(orgId, uid, bytes, contentType);
  await db.doc(Paths.user(orgId, uid)).update({ photoStoragePath: storagePath, photoUpdatedAt: FieldValue.serverTimestamp() });
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
  const { db } = firebaseAdmin();
  await db.collection(Paths.auditLogs(orgId)).add({
    actorUid,
    action,
    targetId,
    metadata: metadata ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}
