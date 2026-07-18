import { sql, withTransaction } from '../db';
import { tsToIso, buildInsert } from '../rows';

// Asset requests with dual approval (admin + lead) — ported from AttendDesk.

function rowFromRow(r) {
  return {
    id: r.id,
    uid: r.uid ?? '',
    userEmail: r.user_email ?? '',
    userName: r.user_name ?? '',
    assetName: r.asset_name ?? '',
    assetType: r.asset_type ?? '',
    description: r.description ?? '',
    fromDay: r.from_day ?? '',
    toDay: r.to_day ?? '',
    totalDays: typeof r.total_days === 'number' ? r.total_days : Number(r.total_days ?? 0),
    requiresLead: !!r.requires_lead,
    status: r.status ?? 'pending',
    adminStatus: r.admin_status ?? 'pending',
    leadStatus: r.lead_status ?? 'pending',
    adminDecidedBy: r.admin_decided_by ?? null,
    adminDecidedAt: tsToIso(r.admin_decided_at),
    adminNote: r.admin_note ?? null,
    leadDecidedBy: r.lead_decided_by ?? null,
    leadDecidedAt: tsToIso(r.lead_decided_at),
    leadNote: r.lead_note ?? null,
    createdAt: tsToIso(r.created_at),
  };
}

export async function getAssetRequests(query = {}, orgId) {
  let text = 'SELECT * FROM asset_requests WHERE org_id = $1';
  const params = [orgId];
  if (query.userId) { params.push(query.userId); text += ` AND uid = $${params.length}`; }
  if (query.status) { params.push(query.status); text += ` AND status = $${params.length}`; }
  text += ` ORDER BY (status = 'pending') DESC, from_day DESC, id DESC`;
  const rows = await sql.query(text, params);
  return { requests: rows.map(rowFromRow) };
}

// body: { userId, assetName, assetType?, description?, fromDay, toDay, requiresLead? }
export async function createAssetRequest(body, orgId) {
  if (body.fromDay > body.toDay) throw Object.assign(new Error('invalid_range'), { status: 400 });
  const u = await sql.query(
    'SELECT email, name FROM users WHERE firebase_uid = $1 AND org_id = $2',
    [body.userId, orgId],
  );
  if (!u.length) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const start = new Date(`${body.fromDay}T00:00:00Z`).getTime();
  const end = new Date(`${body.toDay}T00:00:00Z`).getTime();
  const totalDays = Math.round((end - start) / 86_400_000) + 1;
  const leadStatus = body.requiresLead ? 'pending' : 'approved';
  const obj = {
    org_id: orgId,
    uid: body.userId,
    userEmail: u[0].email ?? '',
    userName: u[0].name || u[0].email || '',
    assetName: body.assetName,
    assetType: body.assetType ?? '',
    description: body.description ?? '',
    fromDay: body.fromDay,
    toDay: body.toDay,
    totalDays,
    requiresLead: !!body.requiresLead,
    status: 'pending',
    adminStatus: 'pending',
    leadStatus,
    adminDecidedBy: null,
    adminDecidedAt: null,
    adminNote: null,
    leadDecidedBy: null,
    leadDecidedAt: null,
    leadNote: null,
  };
  const { text, params } = buildInsert('asset_requests', obj, { returning: 'id' });
  const rows = await sql.query(text, params);
  return { id: rows[0].id };
}

// side: 'admin' | 'lead'. Overall status = approved only when both sides approve;
// rejected if either rejects.
export async function decideAssetRequest(id, side, decision, note, orgId) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT status, admin_status, lead_status FROM asset_requests WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [id, orgId],
    );
    if (!rows.length) throw Object.assign(new Error('not_found'), { status: 404 });
    const d = rows[0];
    if (d.status !== 'pending') throw Object.assign(new Error('not_pending'), { status: 409 });
    const adminStatus = side === 'admin' ? decision : (d.admin_status ?? 'pending');
    const leadStatus = side === 'lead' ? decision : (d.lead_status ?? 'pending');
    const status =
      adminStatus === 'rejected' || leadStatus === 'rejected'
        ? 'rejected'
        : adminStatus === 'approved' && leadStatus === 'approved'
          ? 'approved'
          : 'pending';
    if (side === 'admin') {
      await client.query(
        `UPDATE asset_requests SET admin_status = $1, admin_decided_by = 'lexdesk', admin_decided_at = now(), admin_note = $2, status = $3 WHERE id = $4`,
        [adminStatus, note ?? null, status, id],
      );
    } else {
      await client.query(
        `UPDATE asset_requests SET lead_status = $1, lead_decided_by = 'lexdesk', lead_decided_at = now(), lead_note = $2, status = $3 WHERE id = $4`,
        [leadStatus, note ?? null, status, id],
      );
    }
  });
  return { ok: true };
}
