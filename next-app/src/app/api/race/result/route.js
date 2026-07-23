import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { insertRaceResult, currentSeason } from '@/lib/race';

export const dynamic = 'force-dynamic';

// Race times are bounded: a 3-lap grand prix never finishes in under 30s and we
// stop caring past 10 minutes. Anything faster than the floor is a fabricated
// client payload — we accept it (no signal to cheaters) but never persist it.
const MIN_FINISH_MS = 30_000;
const MAX_TIME_MS = 600_000;

// Clamp a numeric field to [min, max]; `fallback` when absent/NaN (pass null to
// mean "nullable field stays null").
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// POST /api/race/result — record one finished (or DNF'd) race for the caller.
// Signed-in players (same Bearer token as the rest of the app) get their
// user_email attached so results follow them across callsigns; anonymous
// players are tracked by callsign alone.
export async function POST(request) {
  const user = getUserFromRequest(request); // null = anonymous racer, still allowed

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const callsign = String(body?.callsign || '').trim().slice(0, 14);
  if (!callsign) return NextResponse.json({ error: 'callsign is required' }, { status: 400 });

  const place = clampInt(body?.place, 1, 8, null);
  if (place === null) return NextResponse.json({ error: 'place is required (1-8)' }, { status: 400 });

  const trackId = clampInt(body?.trackId, 0, 2, 0);
  const humans = clampInt(body?.humans, 1, 8, 1);
  const timeMs = clampInt(body?.timeMs, 0, MAX_TIME_MS, null); // null = DNF
  const bestLapMs = clampInt(body?.bestLapMs, 0, MAX_TIME_MS, null);

  // Impossible finish time → pretend success, store nothing.
  if (timeMs !== null && timeMs < MIN_FINISH_MS) {
    return NextResponse.json({ ok: true });
  }

  try {
    await insertRaceResult({
      userEmail: user?.email || null,
      callsign,
      trackId,
      place,
      timeMs,
      bestLapMs,
      humans,
      season: currentSeason(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
