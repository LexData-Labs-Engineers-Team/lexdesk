import { NextResponse } from 'next/server';
import { getStandings, getBestLaps, currentSeason } from '@/lib/race';

export const dynamic = 'force-dynamic';

const SEASON_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // 'YYYY-MM'

// GET /api/race/leaderboard?season=YYYY-MM (default: current season).
// Public — the hub shows the podium before anyone signs in.
// Response: {
//   season,
//   standings: top 10 by points [{ name, points, wins, podiums, races }],
//   bestLaps: { 0: [{ name, bestLapMs }...], 1: [...], 2: [...] } top 5 per track
// }
export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const requested = sp.get('season') || '';
  const season = SEASON_RE.test(requested) ? requested : currentSeason();

  try {
    const [standingRows, lapRows] = await Promise.all([getStandings(season), getBestLaps(season)]);

    const standings = standingRows.map((r) => ({
      name: r.name,
      points: r.points,
      wins: r.wins,
      podiums: r.podiums,
      races: r.races,
    }));

    const bestLaps = { 0: [], 1: [], 2: [] };
    for (const r of lapRows) {
      bestLaps[r.track_id]?.push({ name: r.name, bestLapMs: r.best_lap_ms });
    }

    return NextResponse.json({ season, standings, bestLaps });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
