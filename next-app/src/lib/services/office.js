import { sql } from '../db';
import { tsToIso, buildInsert, buildUpdateSet } from '../rows';
import { isValidIpEntry } from '../ip';

// Org office (single row). Ported from AttendDesk; BSSIDs normalized lowercase.

function mapOffice(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    radiusMeters: r.radius_meters,
    allowedSsids: r.allowed_ssids || [],
    allowedBssids: r.allowed_bssids || [],
    allowedIps: r.allowed_ips || [],
    startTime: r.start_time,
    endTime: r.end_time,
    createdAt: tsToIso(r.created_at),
    updatedAt: tsToIso(r.updated_at),
  };
}

export async function getOffice(orgId) {
  const rows = await sql`SELECT * FROM offices WHERE org_id = ${orgId} ORDER BY created_at ASC LIMIT 1`;
  return { office: mapOffice(rows[0]) };
}

// body: { name, lat, lng, radiusMeters, allowedSsids, allowedBssids, allowedIps?, startTime?, endTime? }
export async function updateOffice(body, orgId) {
  const data = {};
  for (const k of ['name', 'lat', 'lng', 'radiusMeters', 'allowedSsids', 'startTime', 'endTime']) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  data.allowedBssids = (body.allowedBssids || []).map((b) => String(b).toLowerCase());
  // Office PUBLIC IPs / CIDRs for the web check-in 'ip' check. Guarded so a body
  // that omits the field doesn't wipe the stored list on a merge write. Reject
  // malformed entries at write time (a bad CIDR must never widen the gate).
  if (body.allowedIps !== undefined) {
    const entries = (body.allowedIps || []).map((s) => String(s).trim()).filter(Boolean);
    const bad = entries.filter((e) => !isValidIpEntry(e));
    if (bad.length) throw Object.assign(new Error(`invalid_office_ip: ${bad.join(', ')}`), { status: 400 });
    data.allowedIps = entries;
  }

  const existingRows = await sql`SELECT * FROM offices WHERE org_id = ${orgId} ORDER BY created_at ASC LIMIT 1`;
  const existing = existingRows[0];

  if (existing) {
    const { setClause, params, nextIndex } = buildUpdateSet(data, { startIndex: 1 });
    const text = `UPDATE offices SET ${setClause}, updated_at = now() WHERE id = $${nextIndex} RETURNING *`;
    const rows = await sql.query(text, [...params, existing.id]);
    return { office: mapOffice(rows[0]) };
  }

  const { text, params } = buildInsert('offices', { ...data, orgId }, { returning: '*' });
  const rows = await sql.query(text, params);
  return { office: mapOffice(rows[0]) };
}
