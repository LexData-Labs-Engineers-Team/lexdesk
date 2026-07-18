import { sql, withTransaction } from '../db';
import { ipInAllowlist, isValidIpEntry } from '../ip';

// Login-time device cap + per-employee IP allowlist. Applies to EMPLOYEE / IT_TEAM
// only (admins/superadmins are exempt so they can never lock themselves out).
// Enforced at web login (/api/auth/login) and on every mobile /api/v1 call via
// getMobileUser. State lives on the users row:
//   login_devices:      [{ deviceId, name, platform, firstSeenAt, lastSeenAt }]  (cap 2)
//   login_ip_allowlist: ['203.0.113.4', '203.0.113.0/24', ...]  (empty = unrestricted)

export const MAX_LOGIN_DEVICES = 2;

// Only refresh a known device's lastSeenAt when it's this stale, so the common
// case (an already-registered device calling in) stays a read, not a write.
const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000;

const RESTRICTED_ROLES = new Set(['EMPLOYEE', 'IT_TEAM']);

// True for the roles the device/IP limits apply to. Normalizes both vocabularies
// (web JWT lowercase 'employee'/'it_team'; uppercase mobile).
export function isRestrictedRole(role) {
  return RESTRICTED_ROLES.has(String(role || '').toUpperCase());
}

function guardError(status, code) {
  return Object.assign(new Error(code), { status });
}

// Enforce the IP allowlist and device cap for a restricted user. No-ops (returns
// { exempt: true }) for admins. Throws { status, message:code } on a violation:
//   403 login_ip_not_allowed | 403 device_limit_reached | 400 device_id_required.
export async function enforceLoginGuards({ orgId, uid, role, deviceId, deviceName, platform, clientIp }) {
  if (!isRestrictedRole(role)) return { ok: true, exempt: true };

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT login_ip_allowlist, login_devices FROM users WHERE firebase_uid = $1 AND org_id = $2 FOR UPDATE',
      [uid, orgId]
    );
    if (!rows.length) throw guardError(404, 'user_not_found');
    const data = rows[0];

    // --- Per-employee login IP allowlist (opt-in: empty list ⇒ unrestricted) ---
    const allowlist = Array.isArray(data.login_ip_allowlist) ? data.login_ip_allowlist : [];
    if (allowlist.length > 0 && !ipInAllowlist(clientIp, allowlist)) {
      throw guardError(403, 'login_ip_not_allowed');
    }

    // --- Device cap ---
    if (!deviceId) throw guardError(400, 'device_id_required');
    const devices = Array.isArray(data.login_devices) ? data.login_devices.map((d) => ({ ...d })) : [];
    const idx = devices.findIndex((d) => d && d.deviceId === deviceId);

    if (idx >= 0) {
      const lastMs = devices[idx].lastSeenAt ? new Date(devices[idx].lastSeenAt).getTime() : 0;
      if (!lastMs || nowMs - lastMs >= LAST_SEEN_THROTTLE_MS) {
        devices[idx].lastSeenAt = nowIso;
        if (deviceName) devices[idx].name = deviceName;
        await client.query(
          'UPDATE users SET login_devices = $1::jsonb WHERE firebase_uid = $2 AND org_id = $3',
          [JSON.stringify(devices), uid, orgId]
        );
      }
      return { ok: true, deviceCount: devices.length };
    }

    if (devices.length >= MAX_LOGIN_DEVICES) throw guardError(403, 'device_limit_reached');

    devices.push({
      deviceId,
      name: deviceName || null,
      platform: platform || null,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    });
    await client.query(
      'UPDATE users SET login_devices = $1::jsonb WHERE firebase_uid = $2 AND org_id = $3',
      [JSON.stringify(devices), uid, orgId]
    );
    return { ok: true, deviceCount: devices.length };
  });
}

// Admin action — clear a user's registered devices so they can sign in on new
// ones. Returns how many were cleared.
export async function resetUserDevices(uid, orgId) {
  const rows = await sql`
    SELECT login_devices FROM users WHERE firebase_uid = ${uid} AND org_id = ${orgId}
  `;
  if (!rows.length) throw guardError(404, 'not_found');
  const cleared = Array.isArray(rows[0].login_devices) ? rows[0].login_devices.length : 0;
  await sql`
    UPDATE users SET login_devices = '[]'::jsonb
    WHERE firebase_uid = ${uid} AND org_id = ${orgId}
  `;
  return { ok: true, cleared };
}

// Admin action — set a user's login IP allowlist. Validates each entry (exact
// IPv4/IPv6 or IPv4 CIDR); a bad entry fails the whole write (mirrors updateOffice).
export async function setUserLoginIps(uid, orgId, ips) {
  const entries = (Array.isArray(ips) ? ips : []).map((s) => String(s).trim()).filter(Boolean);
  const bad = entries.filter((e) => !isValidIpEntry(e));
  if (bad.length) throw Object.assign(new Error(`invalid_ip: ${bad.join(', ')}`), { status: 400 });
  const deduped = [...new Set(entries)];
  const rows = await sql`
    SELECT firebase_uid FROM users WHERE firebase_uid = ${uid} AND org_id = ${orgId}
  `;
  if (!rows.length) throw guardError(404, 'not_found');
  await sql`
    UPDATE users SET login_ip_allowlist = ${deduped}
    WHERE firebase_uid = ${uid} AND org_id = ${orgId}
  `;
  return { ok: true, loginIpAllowlist: deduped };
}
