import { sql, withTransaction } from '../db';
import { tsToIso, buildInsert } from '../rows';
import { getLineManager } from './teams';

// Leave requests — ported from AttendDesk's leaveRequests.ts (single-org, no
// feature gate). Wrapper shapes match the old HTTP responses.

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Leave categories. "Half Day" is special: a single day worth 0.5, with a
// halfDayPeriod ('first' | 'second') saying which half of the day is taken.
const VALID_LEAVE_TYPES = new Set(['Casual', 'Sick', 'Emergency', 'Half Day']);
const VALID_HALF_PERIODS = new Set(['first', 'second']);

function inclusiveDayCount(fromDay, toDay) {
  if (!ISO_DAY_RE.test(fromDay) || !ISO_DAY_RE.test(toDay)) throw Object.assign(new Error('invalid_range'), { status: 400 });
  if (fromDay > toDay) throw Object.assign(new Error('invalid_range'), { status: 400 });
  const start = new Date(`${fromDay}T00:00:00Z`).getTime();
  const end = new Date(`${toDay}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

function rowFromRow(row) {
  const d = row ?? {};
  const legacyReason = typeof d.reason === 'string' ? d.reason : '';
  return {
    id: d.id,
    uid: d.uid ?? '',
    userEmail: d.user_email ?? '',
    userName: d.user_name ?? '',
    fromDay: d.from_day ?? '',
    toDay: d.to_day ?? '',
    totalDays: typeof d.total_days === 'number' ? d.total_days : Number(d.total_days ?? 0),
    leaveType: d.leave_type ?? null,
    halfDayPeriod: d.half_day_period ?? null,
    department: d.department ?? null,
    lineManager: d.line_manager ?? null,
    approvedBy: d.approved_by ?? null,
    subject: d.subject ?? (legacyReason ? 'Leave request' : ''),
    details: d.details ?? legacyReason,
    status: d.status ?? 'pending',
    createdAt: tsToIso(d.created_at),
    decidedAt: tsToIso(d.decided_at),
    decidedBy: d.decided_by ?? null,
    decisionNote: d.decision_note ?? null,
  };
}

export async function getLeaveRequests(query = {}, orgId) {
  let rows;
  if (query.status) {
    rows = await sql`
      SELECT * FROM leave_requests
      WHERE org_id = ${orgId} AND status = ${query.status}
      ORDER BY (status = 'pending') DESC, from_day DESC, id DESC`;
  } else {
    rows = await sql`
      SELECT * FROM leave_requests
      WHERE org_id = ${orgId}
      ORDER BY (status = 'pending') DESC, from_day DESC, id DESC`;
  }
  const requests = rows.map(rowFromRow);
  return { requests };
}

// body: { userId, fromDay, toDay, subject, details?, leaveType?, halfDayPeriod?, approvedBy? }
// Department and lineManager are derived server-side from the user's own record
// and team (not trusted from the client); approvedBy is the employee's stated
// approver, entered on the form.
export async function submitLeave(body, orgId) {
  const leaveType = VALID_LEAVE_TYPES.has(body.leaveType) ? body.leaveType : null;
  const isHalfDay = leaveType === 'Half Day';

  let totalDays;
  let halfDayPeriod = null;
  if (isHalfDay) {
    // A half day is a single calendar day worth 0.5. fromDay must equal toDay.
    if (!ISO_DAY_RE.test(body.fromDay) || body.fromDay !== body.toDay) {
      throw Object.assign(new Error('half_day_single_day'), { status: 400 });
    }
    halfDayPeriod = VALID_HALF_PERIODS.has(body.halfDayPeriod) ? body.halfDayPeriod : 'first';
    totalDays = 0.5;
  } else {
    totalDays = inclusiveDayCount(body.fromDay, body.toDay);
  }

  const userRows = await sql`
    SELECT * FROM users WHERE firebase_uid = ${body.userId} AND org_id = ${orgId}`;
  if (userRows.length === 0) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const u = userRows[0];
  const department = u.department || u.team_name || null;
  const lineManager = await getLineManager(orgId, u.team_id ?? null);
  const approvedBy = String(body.approvedBy || '').trim() || null;

  const { text, params } = buildInsert('leave_requests', {
    orgId,
    uid: body.userId,
    userEmail: u.email ?? '',
    userName: u.name || u.email || '',
    fromDay: body.fromDay,
    toDay: body.toDay,
    totalDays,
    leaveType,
    halfDayPeriod,
    department,
    lineManager,
    approvedBy,
    subject: body.subject,
    details: body.details ?? '',
    status: 'pending',
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
  }, { returning: 'id' });
  const rows = await sql.query(text, params);
  return { id: rows[0].id };
}

// Mobile: a user's OWN leave requests (equality-only query, client sort).
export async function listMyLeaveRequests(orgId, uid) {
  const rows = await sql`
    SELECT * FROM leave_requests
    WHERE org_id = ${orgId} AND uid = ${uid}
    ORDER BY from_day DESC, id DESC`;
  const requests = rows.map(rowFromRow);
  return { requests };
}

// Mobile: cancel one of the caller's OWN pending requests.
export async function cancelMyLeaveRequest(orgId, uid, id) {
  const request = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM leave_requests WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [orgId, id]
    );
    if (rows.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
    const data = rows[0];
    if (String(data.uid) !== String(uid)) throw Object.assign(new Error('forbidden'), { status: 403 });
    if (data.status !== 'pending') throw Object.assign(new Error('not_pending'), { status: 409 });
    const { rows: updated } = await client.query(
      `UPDATE leave_requests
         SET status = 'cancelled', decided_at = now(), decided_by = $1, decision_note = NULL
       WHERE org_id = $2 AND id = $3
       RETURNING *`,
      [uid, orgId, id]
    );
    return rowFromRow(updated[0]);
  });
  return { request };
}

export async function decideLeave(id, decision, note, orgId) {
  const request = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM leave_requests WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [orgId, id]
    );
    if (rows.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
    if (rows[0].status !== 'pending') throw Object.assign(new Error('not_pending'), { status: 409 });
    const { rows: updated } = await client.query(
      `UPDATE leave_requests
         SET status = $1, decided_at = now(), decided_by = 'lexdesk', decision_note = $2
       WHERE org_id = $3 AND id = $4
       RETURNING *`,
      [decision, note ?? null, orgId, id]
    );
    return rowFromRow(updated[0]);
  });
  return { ok: true, request };
}
