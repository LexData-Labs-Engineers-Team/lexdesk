import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { signToken, publicUser, verifyFirebasePassword, roleToLexdesk, initialsFromName } from '@/lib/auth';
import { firebaseAdmin } from '@/lib/firebase';
import { Paths } from '@/lib/paths';
import { ORG_ID } from '@/lib/config';
import { clientIpFromHeaders } from '@/lib/ip';
import { enforceLoginGuards } from '@/lib/services/loginGuard';

export const dynamic = 'force-dynamic';

// Friendly, non-enumerating messages for the login device/IP guard.
const LOGIN_GUARD_MESSAGES = {
  device_limit_reached:
    'You are already signed in on the maximum of 2 devices. Ask your admin to reset your devices to use a new one.',
  login_ip_not_allowed: 'You can’t sign in from this network. Contact your admin.',
  device_id_required: 'This browser could not be identified. Enable site storage and try again.',
};

// Login: verify the password against Firebase Auth (shared project), then read
// the role from the org's Firestore user doc and mint LexDesk's own JWT. The
// frontend's localStorage + Bearer flow is unchanged.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }
  // Device identity for the 2-device login cap (browser-generated; see lib/deviceId.js).
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  const deviceName = typeof body?.deviceName === 'string' ? body.deviceName.trim().slice(0, 200) : null;
  const clientIp = clientIpFromHeaders(request.headers);

  // System admin — env-configured (LEXDESK_SYSADMIN_EMAIL/PASSWORD), no Firebase
  // user. Mints a full 'superadmin' session (can reset the org admin's password
  // from the dashboard). Checked BEFORE Firebase so it works without a Firestore
  // doc; inert unless both env vars are set. Password compared in constant time.
  const sysEmail = process.env.LEXDESK_SYSADMIN_EMAIL;
  const sysPassword = process.env.LEXDESK_SYSADMIN_PASSWORD;
  if (sysEmail && sysPassword && String(email).toLowerCase() === sysEmail.toLowerCase()) {
    const a = Buffer.from(String(password));
    const b = Buffer.from(String(sysPassword));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    const sysUser = {
      id: 'sysadmin',
      email: sysEmail,
      name: 'System Admin',
      role: 'superadmin',
      avatar: 'SA',
      employeeId: null,
      orgId: ORG_ID,
    };
    try {
      const token = signToken(sysUser);
      return NextResponse.json({ token, user: publicUser(sysUser) });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  let verified;
  try {
    verified = await verifyFirebasePassword(email, password);
  } catch (err) {
    return NextResponse.json(
      { error: 'Authentication service unavailable', detail: err?.message || 'auth_error' },
      { status: 502 },
    );
  }
  if (!verified) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // The user must belong to this LexDesk org (single tenant). Their profile doc
  // is the source of truth for role/name. Wrapped so any Firestore/config
  // failure returns JSON (not an unhandled HTML 500 the client can't parse).
  try {
    const { db } = firebaseAdmin();
    const snap = await db.doc(Paths.user(ORG_ID, verified.uid)).get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: 'This account is not part of your organization. Ask your admin to add you.' },
        { status: 401 },
      );
    }
    const data = snap.data();
    const name = data.name || verified.email || email;
    const user = {
      id: verified.uid,
      email: verified.email || email,
      name,
      role: roleToLexdesk(data.role),
      avatar: initialsFromName(name),
      employeeId: data.employeeId ?? null,
      orgId: ORG_ID,
    };

    // Device cap + per-employee IP allowlist (employees / IT team only; admins
    // are exempt). Runs after auth, before we mint a session.
    try {
      await enforceLoginGuards({
        orgId: user.orgId,
        uid: user.id,
        role: user.role,
        deviceId,
        deviceName,
        platform: 'web',
        clientIp,
      });
    } catch (guardErr) {
      const msg = LOGIN_GUARD_MESSAGES[guardErr.message] || 'Sign-in is not allowed on this device.';
      return NextResponse.json({ error: msg, code: guardErr.message }, { status: guardErr.status || 403 });
    }

    const token = signToken(user);
    return NextResponse.json({ token, user: publicUser(user) });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'login_failed' }, { status: 500 });
  }
}
