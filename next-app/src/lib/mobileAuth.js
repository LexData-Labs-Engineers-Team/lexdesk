import { NextResponse } from 'next/server';
import { firebaseAdmin } from './firebase';
import { Paths } from './paths';
import { ORG_ID } from './config';
import { isManager } from './services/teams';
import { clientIpFromHeaders } from './ip';
import { enforceLoginGuards, isRestrictedRole } from './services/loginGuard';

// Mobile auth: the Android app sends a Firebase ID token (Bearer). We verify it
// with the Admin SDK and resolve the user's role. Single-org, so orgId is
// pinned to ORG_ID. role comes from the token's custom claims, falling back to
// userIndex/{uid} then the org user doc (seed/createEmployee write both). This
// is SEPARATE from the web's getUserFromRequest (LexDesk JWT) — both coexist.

export class MobileAuthError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function getMobileUser(request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw new MobileAuthError(401, 'missing_bearer_token');
  const token = header.slice(7).trim();

  const { auth, db } = firebaseAdmin();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token, true);
  } catch {
    throw new MobileAuthError(401, 'invalid_token');
  }

  const uid = decoded.uid;
  const email = decoded.email || '';
  let role = decoded.role;
  if (!role) {
    const idx = await db.doc(Paths.userIndex(uid)).get();
    if (idx.exists) role = idx.data().role;
  }
  if (!role) {
    const u = await db.doc(Paths.user(ORG_ID, uid)).get();
    if (u.exists) role = u.data().role;
  }
  if (!role) throw new MobileAuthError(403, 'missing_claims');

  // Device cap + per-employee IP allowlist. This is the single chokepoint every
  // /api/v1 call passes through, so an unauthorized device/IP is blocked app-wide.
  // Admins are exempt; the device write is throttled inside enforceLoginGuards.
  if (isRestrictedRole(role)) {
    const deviceId = (request.headers.get('x-device-id') || '').trim();
    const deviceName = (request.headers.get('x-device-name') || '').trim().slice(0, 200) || null;
    try {
      await enforceLoginGuards({
        orgId: ORG_ID,
        uid,
        role,
        deviceId,
        deviceName,
        platform: 'android',
        clientIp: clientIpFromHeaders(request.headers),
      });
    } catch (e) {
      throw new MobileAuthError(e.status || 403, e.message || 'device_check_failed');
    }
  }

  return { uid, email, role, orgId: ORG_ID };
}

// Manager gate for /api/v1/manage/* routes. Throws a 403 MobileAuthError when
// the caller is neither an admin/superadmin nor a team leader.
export async function requireManager(user) {
  const ok = await isManager(user.orgId, user.uid, user.role);
  if (!ok) throw new MobileAuthError(403, 'forbidden');
}

// Map a thrown error to a JSON response for /api/v1 routes.
export function mobileAuthError(err) {
  if (err instanceof MobileAuthError) {
    return NextResponse.json({ error: err.code }, { status: err.status });
  }
  return NextResponse.json(
    { error: err?.message || 'internal_error', upstream: err?.body ?? null },
    { status: err?.status || 500 },
  );
}
