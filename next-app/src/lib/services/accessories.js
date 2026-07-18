import { sql } from '../db';
import { tsToIso, buildInsert } from '../rows';

// IT Team accessories inventory — what the company has and how many. Pure
// count tracking; IP/assignment lives in the separate Tracking section.

export async function getAccessories(orgId) {
  const rows = await sql`
    SELECT id, name, quantity, notes, created_at
    FROM accessory_items
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
  `;
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    quantity: typeof r.quantity === 'number' ? r.quantity : 0,
    notes: r.notes ?? null,
    createdAt: tsToIso(r.created_at),
  }));
  return { items };
}

// body: { name, quantity?, notes? }
export async function createAccessory(body, orgId) {
  const name = String(body?.name || '').trim();
  if (!name) throw Object.assign(new Error('Accessory name is required'), { status: 400 });
  const qty = Number.parseInt(body?.quantity, 10);
  const quantity = Number.isFinite(qty) && qty >= 0 ? qty : 1;
  const { text, params } = buildInsert('accessory_items', {
    orgId,
    name,
    quantity,
    notes: String(body?.notes || '').trim() || null,
    createdBy: 'lexdesk',
  }, { returning: 'id' });
  const rows = await sql.query(text, params);
  return { id: rows[0].id };
}

export async function deleteAccessory(id, orgId) {
  const rows = await sql`
    DELETE FROM accessory_items
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id
  `;
  if (rows.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
  return { ok: true };
}
