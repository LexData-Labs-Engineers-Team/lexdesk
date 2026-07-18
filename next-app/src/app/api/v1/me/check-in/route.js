import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { processCheckIn } from '@/lib/services/attendance';

export const dynamic = 'force-dynamic';

// POST /api/v1/me/check-in — full anti-cheat check-in/out from the mobile app.
// uid/email come from the verified ID token; clientMode is forced to 'mobile'.
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
  if (body?.type !== 'CHECK_IN' && body?.type !== 'CHECK_OUT') {
    return NextResponse.json({ error: 'type must be CHECK_IN or CHECK_OUT' }, { status: 400 });
  }

  try {
    // Strip any client-supplied clientIp: the office-IP check is web-only and
    // its IP is server-derived, so a mobile body must never activate or feed it.
    const { clientIp: _ignoredClientIp, ...safeBody } = body;
    const outcome = await processCheckIn(user.uid, user.orgId, user.email, { ...safeBody, clientMode: 'mobile' });
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ error: e.message, upstream: e.body ?? null }, { status: e.status || 500 });
  }
}
