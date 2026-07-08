import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { firebaseAdmin } from '@/lib/firebase';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/v1/auth/set-password — { newPassword }. Updates Firebase Auth,
// revokes refresh tokens (forces re-auth), clears mustChangePassword.
export async function POST(request) {
  let user;
  try {
    user = await getMobileUser(request);
  } catch (e) {
    return mobileAuthError(e);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const newPassword = body?.newPassword;
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json({ error: 'password must be 8-128 characters' }, { status: 400 });
  }

  try {
    const { auth } = firebaseAdmin();
    await auth.updateUser(user.uid, { password: newPassword });
    await auth.revokeRefreshTokens(user.uid);
    await sql`UPDATE users SET must_change_password = false WHERE firebase_uid = ${user.uid} AND org_id = ${user.orgId}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
