import { sql, withTransaction } from '../db';
import { tsToIso } from '../rows';
import { createRequestService } from './requestKit';

// Remote WORK SESSION: an employee taps Start (reason + optional location) →
// status 'working' with startedAt; works; taps Done → endedAt + server-computed
// durationMinutes, status 'pending'. A team lead / admin then approves or rejects.
// Remote hours are a SEPARATE log — approval does NOT write attendance events
// (it no longer marks the day present).
//
// status lifecycle: working → pending → approved | rejected ; cancelled (from working/pending)

const svc = createRequestService({
  table: 'remote_requests',
  pick: (row) => ({
    day: row.day ?? '',
    reason: row.reason ?? '',
    place: row.place ?? '',
    lat: typeof row.lat === 'number' ? row.lat : null,
    lng: typeof row.lng === 'number' ? row.lng : null,
    startedAt: tsToIso(row.started_at),
    endedAt: tsToIso(row.ended_at),
    durationMinutes: row.duration_minutes ?? null,
  }),
  build: () => ({}), // remote creates via startRemote below, not the generic submit
});

export const getRemoteRequests = (query, orgId) => svc.list(query, orgId);
export const listMyRemote = (orgId, uid) => svc.listMine(orgId, uid);
export const getRemote = (orgId, id) => svc.getOne(orgId, id);

// Office-tz (Asia/Dhaka) calendar day for stamping the session's day.
function todayDhaka() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// START a remote work session. One active ('working') session per user at a time.
// Exported as submitRemote too so the existing POST route keeps working.
export async function startRemote(body, orgId) {
  const uid = body.userId;
  const users = await sql`SELECT email, name FROM users WHERE firebase_uid = ${uid} AND org_id = ${orgId}`;
  if (!users.length) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const u = users[0];
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw Object.assign(new Error('reason_required'), { status: 400 });

  // The partial unique index uq_remote_one_working enforces one active session
  // per (org_id, uid); a concurrent 'working' insert collides -> 23505.
  try {
    const rows = await sql`
      INSERT INTO remote_requests
        (org_id, uid, user_email, user_name, day, reason, place, lat, lng,
         status, started_at, ended_at, duration_minutes, created_at,
         decided_at, decided_by, decision_note)
      VALUES
        (${orgId}, ${uid}, ${u.email ?? ''}, ${u.name || u.email || ''},
         ${todayDhaka()}, ${reason}, ${String(body.place ?? '').trim()},
         ${typeof body.lat === 'number' ? body.lat : null},
         ${typeof body.lng === 'number' ? body.lng : null},
         'working', now(), NULL, NULL, now(), NULL, NULL, NULL)
      RETURNING id`;
    return { id: rows[0].id, status: 'working' };
  } catch (e) {
    if (e && e.code === '23505') throw Object.assign(new Error('already_working'), { status: 409 });
    throw e;
  }
}
export const submitRemote = (body, orgId) => startRemote(body, orgId);

// DONE — the owner ends their 'working' session. Duration is computed from the
// SERVER timestamps (never the client clock) and the session goes to 'pending'.
export async function doneRemote(orgId, uid, id) {
  const durationMinutes = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT uid, status, started_at FROM remote_requests WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [id, orgId],
    );
    if (!rows.length) throw Object.assign(new Error('not_found'), { status: 404 });
    const d = rows[0];
    if (String(d.uid) !== String(uid)) throw Object.assign(new Error('forbidden'), { status: 403 });
    if (d.status !== 'working') throw Object.assign(new Error('not_working'), { status: 409 });
    const startedMs = d.started_at instanceof Date ? d.started_at.getTime() : null;
    const mins = startedMs ? Math.max(0, Math.round((Date.now() - startedMs) / 60000)) : 0;
    await client.query(
      "UPDATE remote_requests SET status = 'pending', ended_at = now(), duration_minutes = $1 WHERE id = $2",
      [mins, id],
    );
    return mins;
  });
  const fresh = await sql`SELECT * FROM remote_requests WHERE id = ${id}`;
  return { ok: true, durationMinutes, request: svc.rowFromRow(fresh[0]) };
}

// Owner cancels — allowed while 'working' (discard) or 'pending' (withdraw).
export async function cancelMyRemote(orgId, uid, id) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT uid, status FROM remote_requests WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [id, orgId],
    );
    if (!rows.length) throw Object.assign(new Error('not_found'), { status: 404 });
    const d = rows[0];
    if (String(d.uid) !== String(uid)) throw Object.assign(new Error('forbidden'), { status: 403 });
    if (d.status !== 'working' && d.status !== 'pending') {
      throw Object.assign(new Error('not_cancellable'), { status: 409 });
    }
    await client.query(
      "UPDATE remote_requests SET status = 'cancelled', decided_at = now(), decided_by = $1, decision_note = NULL WHERE id = $2",
      [uid, id],
    );
  });
  return { ok: true };
}

// Manager approve/reject of a completed (pending) session. Hours-log-only:
// this records the decision and does NOT write any attendance (present) events.
export async function decideRemote(id, decision, note, orgId, deciderUid) {
  return svc.decide(id, decision, note, orgId, deciderUid);
}
