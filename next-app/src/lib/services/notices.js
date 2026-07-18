import { sql } from '../db';
import { tsToIso } from '../rows';

// Notice board — admins author announcements; everyone reads. No approval.

function rowFrom(r) {
  return {
    id: r.id,
    title: r.title ?? '',
    body: r.body ?? '',
    pinned: !!r.pinned,
    createdAt: tsToIso(r.created_at),
    createdBy: r.created_by ?? null,
  };
}

// Pinned first, then newest.
export async function listNotices(orgId, limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await sql`
    SELECT * FROM notices
    WHERE org_id = ${orgId}
    ORDER BY pinned DESC, created_at DESC
    LIMIT ${n}
  `;
  return { notices: rows.map(rowFrom) };
}

// body: { title, body?, pinned? }
export async function createNotice(body, orgId, authorUid) {
  const title = String(body?.title ?? '').trim();
  if (!title) throw Object.assign(new Error('title_required'), { status: 400 });
  const rows = await sql`
    INSERT INTO notices (org_id, title, body, pinned, created_at, created_by)
    VALUES (${orgId}, ${title}, ${String(body?.body ?? '').trim()}, ${!!body?.pinned}, now(), ${authorUid ?? 'lexdesk'})
    RETURNING id
  `;
  return { id: rows[0].id };
}

export async function deleteNotice(id, orgId) {
  const rows = await sql`
    DELETE FROM notices WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id
  `;
  if (rows.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
  return { ok: true };
}
