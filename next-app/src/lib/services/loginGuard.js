import { firebaseAdmin } from '../firebase';
import { Paths } from '../paths';
import { ipInAllowlist, isValidIpEntry } from '../ip';

// Login-time device cap + per-employee IP allowlist. Applies to EMPLOYEE / IT_TEAM
// only (admins/superadmins are exempt so they can never lock themselves out).
// Enforced at web login (/api/auth/login) and on every mobile /api/v1 call via
// getMobileUser. State lives on the user doc:
//   loginDevices:     [{ deviceId, name, platform, firstSeenAt, lastSeenAt }]  (cap 2)
//   loginIpAllowlist: ['203.0.113.4', '203.0.113.0/24', ...]  (empty = unrestricted)

export const MAX_LOGIN_DEVICES = 2;

// Only refresh a known device's lastSeenAt when it's this stale, so the common
// case (an already-registered device calling in) stays a read, not a write.
const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000;

const RESTRICTED_ROLES = new Set(['EMPLOYEE', 'IT_TEAM']);

// True for the roles the device/IP limits apply to. Normalizes both vocabularies
// (web JWT lowercase 'employee'/'it_team'; Firestore/mobile uppercase).
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

  const { db } = firebaseAdmin();
  const ref = db.doc(Paths.user(orgId, uid));
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw guardError(404, 'user_not_found');
    const data = snap.data() || {};

    // --- Per-employee login IP allowlist (opt-in: empty list ⇒ unrestricted) ---
    const allowlist = Array.isArray(data.loginIpAllowlist) ? data.loginIpAllowlist : [];
    if (allowlist.length > 0 && !ipInAllowlist(clientIp, allowlist)) {
      throw guardError(403, 'login_ip_not_allowed');
    }

    // --- Device cap ---
    if (!deviceId) throw guardError(400, 'device_id_required');
    const devices = Array.isArray(data.loginDevices) ? data.loginDevices.map((d) => ({ ...d })) : [];
    const idx = devices.findIndex((d) => d && d.deviceId === deviceId);

    if (idx >= 0) {
      const lastMs = devices[idx].lastSeenAt ? new Date(devices[idx].lastSeenAt).getTime() : 0;
      if (!lastMs || nowMs - lastMs >= LAST_SEEN_THROTTLE_MS) {
        devices[idx].lastSeenAt = nowIso;
        if (deviceName) devices[idx].name = deviceName;
        tx.update(ref, { loginDevices: devices });
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
    tx.update(ref, { loginDevices: devices });
    return { ok: true, deviceCount: devices.length };
  });
}

// Admin action — clear a user's registered devices so they can sign in on new
// ones. Returns how many were cleared.
export async function resetUserDevices(uid, orgId) {
  const { db } = firebaseAdmin();
  const ref = db.doc(Paths.user(orgId, uid));
  const snap = await ref.get();
  if (!snap.exists) throw guardError(404, 'not_found');
  const cleared = Array.isArray(snap.data().loginDevices) ? snap.data().loginDevices.length : 0;
  await ref.update({ loginDevices: [] });
  return { ok: true, cleared };
}

// Admin action — set a user's login IP allowlist. Validates each entry (exact
// IPv4/IPv6 or IPv4 CIDR); a bad entry fails the whole write (mirrors updateOffice).
export async function setUserLoginIps(uid, orgId, ips) {
  const entries = (Array.isArray(ips) ? ips : []).map((s) => String(s).trim()).filter(Boolean);
  const bad = entries.filter((e) => !isValidIpEntry(e));
  if (bad.length) throw Object.assign(new Error(`invalid_ip: ${bad.join(', ')}`), { status: 400 });
  const deduped = [...new Set(entries)];
  const { db } = firebaseAdmin();
  const ref = db.doc(Paths.user(orgId, uid));
  const snap = await ref.get();
  if (!snap.exists) throw guardError(404, 'not_found');
  await ref.update({ loginIpAllowlist: deduped });
  return { ok: true, loginIpAllowlist: deduped };
}
