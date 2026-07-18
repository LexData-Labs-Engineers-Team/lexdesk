import { sql } from '../db';
import { tsToIso } from '../rows';

// Break time — start/end break events per user. No approval. Simple event log,
// same Asia/Dhaka day handling the rest of the app uses.

// action: 'start' | 'end'
export async function recordBreak(orgId, uid, action) {
  if (action !== 'start' && action !== 'end') throw Object.assign(new Error('invalid_action'), { status: 400 });
  const type = action === 'start' ? 'BREAK_START' : 'BREAK_END';
  const rows = await sql`
    INSERT INTO break_events (org_id, uid, type, timestamp)
    VALUES (${orgId}, ${uid}, ${type}, now())
    RETURNING id
  `;
  return { id: rows[0].id, type };
}

export async function listMyBreaks(orgId, uid, limit = 100) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = await sql`
    SELECT id, type, timestamp
    FROM break_events
    WHERE org_id = ${orgId} AND uid = ${uid}
    ORDER BY timestamp DESC
    LIMIT ${n}
  `;
  const events = rows.map((r) => ({ id: r.id, type: r.type, timestamp: tsToIso(r.timestamp) }));
  // Derive whether the user is currently on a break (latest event is a START).
  const onBreak = events.length > 0 && events[0].type === 'BREAK_START';
  return { events, onBreak };
}
