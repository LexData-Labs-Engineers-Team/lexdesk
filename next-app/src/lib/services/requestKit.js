import { sql, withTransaction } from '../db';
import { tsToIso, buildInsert } from '../rows';

// Shared "request → single approval" engine (Postgres). Reconciliation and
// Remote-attendance follow the same lifecycle as leave (an employee submits, a
// manager approves/rejects, the owner may cancel while pending), so the
// boilerplate lives here once. Each module supplies its own field spec.
//
// spec = {
//   table: 'recon_requests',                                  // fixed literal, never user input
//   pick:  (row)  => ({ ...module-specific fields }),         // reads snake columns -> camel
//   build: (body) => ({ ...module-specific camelCase fields })// for create (throws on invalid)
// }

const err = (status, code, extra) => Object.assign(new Error(code), { status, ...extra });

export function createRequestService(spec) {
  const table = spec.table; // literal per service; safe to interpolate into SQL text

  function rowFromRow(r) {
    return {
      id: r.id,
      uid: r.uid ?? '',
      userEmail: r.user_email ?? '',
      userName: r.user_name ?? '',
      ...spec.pick(r),
      status: r.status ?? 'pending',
      createdAt: tsToIso(r.created_at),
      decidedAt: tsToIso(r.decided_at),
      decidedBy: r.decided_by ?? null,
      decisionNote: r.decision_note ?? null,
    };
  }

  // Org-wide list (optionally filtered by status / uid) — for managers/admins.
  // Pending first, then newest id first (matches the old in-memory sort).
  async function list(query = {}, orgId) {
    let text = `SELECT * FROM ${table} WHERE org_id = $1`;
    const params = [orgId];
    if (query.userId) { params.push(query.userId); text += ` AND uid = $${params.length}`; }
    if (query.status) { params.push(query.status); text += ` AND status = $${params.length}`; }
    text += ` ORDER BY (status = 'pending') DESC, id DESC`;
    const rows = await sql.query(text, params);
    return { requests: rows.map(rowFromRow) };
  }

  // The caller's own requests, newest first.
  async function listMine(orgId, uid) {
    const rows = await sql.query(
      `SELECT * FROM ${table} WHERE org_id = $1 AND uid = $2 ORDER BY created_at DESC NULLS LAST, id DESC`,
      [orgId, uid],
    );
    return { requests: rows.map(rowFromRow) };
  }

  // body must carry userId (forced from the token by the route).
  async function submit(body, orgId) {
    const u = await sql.query(
      'SELECT email, name FROM users WHERE firebase_uid = $1 AND org_id = $2',
      [body.userId, orgId],
    );
    if (!u.length) throw err(404, 'user_not_found');
    const fields = spec.build(body); // throws {status:400} on invalid input
    const obj = {
      org_id: orgId,
      uid: body.userId,
      user_email: u[0].email ?? '',
      user_name: u[0].name || u[0].email || '',
      status: 'pending',
      ...fields, // camelCase module fields -> buildInsert maps to snake columns
    };
    const { text, params } = buildInsert(table, obj, { returning: 'id' });
    const rows = await sql.query(text, params);
    return { id: rows[0].id };
  }

  // Owner cancels their own pending request.
  async function cancelMine(orgId, uid, id) {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT uid, status FROM ${table} WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [id, orgId],
      );
      if (!rows.length) throw err(404, 'not_found');
      if (String(rows[0].uid) !== String(uid)) throw err(403, 'forbidden');
      if (rows[0].status !== 'pending') throw err(409, 'not_pending');
      await client.query(
        `UPDATE ${table} SET status = 'cancelled', decided_at = now(), decided_by = $1, decision_note = NULL WHERE id = $2`,
        [uid, id],
      );
    });
    const rows = await sql.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return { request: rowFromRow(rows[0]) };
  }

  // Manager/admin decision. deciderUid is recorded so the app shows who acted.
  async function decide(id, decision, note, orgId, deciderUid) {
    if (decision !== 'approved' && decision !== 'rejected') throw err(400, 'bad_decision');
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT status FROM ${table} WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [id, orgId],
      );
      if (!rows.length) throw err(404, 'not_found');
      if (rows[0].status !== 'pending') throw err(409, 'not_pending');
      await client.query(
        `UPDATE ${table} SET status = $1, decided_at = now(), decided_by = $2, decision_note = $3 WHERE id = $4`,
        [decision, deciderUid || 'lexdesk', note ?? null, id],
      );
    });
    const rows = await sql.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return { ok: true, request: rowFromRow(rows[0]) };
  }

  // Fetch one row (used by manager routes to verify team membership before deciding).
  async function getOne(orgId, id) {
    const rows = await sql.query(`SELECT * FROM ${table} WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return rows.length ? rowFromRow(rows[0]) : null;
  }

  // rowFromDoc kept as an alias for callers that used the Firestore-era name.
  return { rowFromRow, rowFromDoc: rowFromRow, list, listMine, submit, cancelMine, decide, getOne };
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive day count for a from/to range; throws on a bad/inverted range. */
export function inclusiveDayCount(fromDay, toDay) {
  if (!ISO_DAY_RE.test(fromDay) || !ISO_DAY_RE.test(toDay)) throw Object.assign(new Error('invalid_range'), { status: 400 });
  if (fromDay > toDay) throw Object.assign(new Error('invalid_range'), { status: 400 });
  const start = new Date(`${fromDay}T00:00:00Z`).getTime();
  const end = new Date(`${toDay}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

export { ISO_DAY_RE };
