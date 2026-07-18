import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkIn } from '@/lib/backend';
import { clientIpFromHeaders } from '@/lib/ip';

export const dynamic = 'force-dynamic';

// GPS- and face-verified check-in/out from the browser. The uid comes from the
// VERIFIED token and the upstream payload is rebuilt from a whitelist, so a
// client can never check in as someone else or smuggle trust-elevating fields
// (clientMode, qrToken). clientMode is omitted on purpose: AttendDesk defaults
// it to 'mobile', which runs the full server-side policy validation.
// isMockLocation is omitted — a browser can't detect mocking, and sending
// false would assert something we never verified. faceLivenessOk is omitted
// for the same honesty reason (the server passes liveness on null; we do no
// browser liveness). faceEmbeddingB64 is the one optional extra: it's
// validated to be exactly a 512-byte float32 embedding, then matched
// server-side against the user's enrollment.

export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.id || !user.orgId) {
    return NextResponse.json({ error: 'no_linked_attenddesk_user' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const type = body?.type;
  if (type !== 'CHECK_IN' && type !== 'CHECK_OUT') {
    return NextResponse.json({ error: 'type must be CHECK_IN or CHECK_OUT' }, { status: 400 });
  }

  const payload = { userId: String(user.id), type };
  // GPS is optional: with the office-IP check, a valid office IP can satisfy the
  // location requirement on its own (desktop browsers often can't get an
  // accurate fix, or the user denies location). Coords, when sent, must be valid;
  // when absent, the geo check yields 'missing_location' and IP can carry it.
  const hasGps = body?.lat != null || body?.lng != null || body?.accuracyMeters != null;
  if (hasGps) {
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    const accuracyMeters = Number(body?.accuracyMeters);
    if (
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180 ||
      !Number.isFinite(accuracyMeters) || accuracyMeters < 0
    ) {
      return NextResponse.json({ error: 'lat, lng and accuracyMeters must be valid when provided' }, { status: 400 });
    }
    payload.lat = lat;
    payload.lng = lng;
    payload.accuracyMeters = accuracyMeters;
  }
  // Server-derived office-IP signal for the web 'ip' check (mobile never sends
  // this, so the IP check is web-only). Whitelisted here, never read from body.
  payload.clientIp = clientIpFromHeaders(request.headers) || '';
  // Device-adaptive web location: mobile browsers (which have GPS) must also pass
  // the geofence; desktop browsers rely on office-IP. Derived from the User-Agent
  // server-side (whitelisted, never read from the body).
  const ua = request.headers.get('user-agent') || '';
  payload.webDevice = /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua) ? 'mobile' : 'desktop';
  const face = body?.faceEmbeddingB64;
  if (face != null) {
    const validFace =
      typeof face === 'string' &&
      face.length <= 700 && // 512-byte embedding = exactly 684 base64 chars
      Buffer.from(face, 'base64').length === 512;
    if (!validFace) {
      return NextResponse.json({ error: 'invalid_face_embedding' }, { status: 400 });
    }
    payload.faceEmbeddingB64 = face;
  }

  try {
    const result = await checkIn(payload, user.orgId);
    // AttendDesk returns 2xx even when checks fail (ok:false, per-check
    // results) — pass it through as data so the UI can render each check.
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
