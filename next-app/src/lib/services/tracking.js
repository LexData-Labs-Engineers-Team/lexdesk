import { sql } from '../db';
import { buildInsert } from '../rows';
import { tsToIso } from '../rows';

// IT Team tracking — assignment records: which item/accessory has which IP and
// who/what it's assigned to. Inventory counts live in the Accessories section.

export async function getTracking(orgId) {
  const rows = await sql`
    SELECT id, name, ip_address, assigned_to, notes, created_at
    FROM tracking_items
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
  `;
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    ipAddress: r.ip_address ?? null,
    assignedTo: r.assigned_to ?? null,
    notes: r.notes ?? null,
    createdAt: tsToIso(r.created_at),
  }));
  return { items };
}

// body: { name, ipAddress?, assignedTo?, notes? }
export async function createTracking(body, orgId) {
  const name = String(body?.name || '').trim();
  if (!name) throw Object.assign(new Error('Item / accessory is required'), { status: 400 });
  const { text, params } = buildInsert(
    'tracking_items',
    {
      orgId,
      name,
      ipAddress: String(body?.ipAddress || '').trim() || null,
      assignedTo: String(body?.assignedTo || '').trim() || null,
      notes: String(body?.notes || '').trim() || null,
      createdBy: 'lexdesk',
    },
    { returning: 'id' }
  );
  const rows = await sql.query(text, params);
  return { id: rows[0].id };
}

export async function deleteTracking(id, orgId) {
  const rows = await sql`
    DELETE FROM tracking_items
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id
  `;
  if (rows.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
  return { ok: true };
}
