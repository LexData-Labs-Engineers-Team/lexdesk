import { sql } from '@/lib/db';

// Nebula Grand Prix persistent results (the multiplayer race in the homepage hub).
// The main app schema lives in db/schema.sql and is applied once by hand; this
// table is game-side and self-provisions instead: CREATE TABLE IF NOT EXISTS on
// first use, behind a module-level promise guard so a warm instance runs the DDL
// at most once. On failure the guard resets so the next request retries.

let _ready;

async function createTable() {
  // Neon's HTTP driver runs one statement per query — issue the DDL separately.
  await sql`CREATE TABLE IF NOT EXISTS race_results (
    id serial PRIMARY KEY,
    user_email text,
    callsign text NOT NULL,
    track_id int NOT NULL DEFAULT 0,
    place int NOT NULL,
    time_ms int,
    best_lap_ms int,
    humans int NOT NULL DEFAULT 1,
    season text NOT NULL,
    created_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_race_results_season ON race_results (season)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_race_results_track_lap
    ON race_results (season, track_id, best_lap_ms) WHERE best_lap_ms IS NOT NULL`;
}

function ensureRaceTable() {
  if (!_ready) {
    _ready = createTable().catch((err) => {
      _ready = undefined; // don't cache a rejected promise — retry next call
      throw err;
    });
  }
  return _ready;
}

// Current season key, e.g. '2026-07' (UTC — the season boundary is a game
// concept, not payroll, so UTC is fine and stable across server regions).
export function currentSeason() {
  return new Date().toISOString().slice(0, 7);
}

// time_ms / best_lap_ms NULL = DNF / no clean lap.
export async function insertRaceResult({ userEmail, callsign, trackId, place, timeMs, bestLapMs, humans, season }) {
  await ensureRaceTable();
  await sql`INSERT INTO race_results (user_email, callsign, track_id, place, time_ms, best_lap_ms, humans, season)
    VALUES (${userEmail}, ${callsign}, ${trackId}, ${place}, ${timeMs}, ${bestLapMs}, ${humans}, ${season})`;
}

// Championship standings: one row per racer identity (user_email when signed in,
// else callsign), finishers only (time_ms NOT NULL), real multiplayer races only
// (humans >= 2). Points: P1=9 P2=6 P3=4 P4=3 P5=2, any other finish 1.
// `name` is the callsign on the racer's most recent result.
export async function getStandings(season) {
  await ensureRaceTable();
  return sql`
    SELECT
      (array_agg(callsign ORDER BY created_at DESC))[1] AS name,
      SUM(CASE place WHEN 1 THEN 9 WHEN 2 THEN 6 WHEN 3 THEN 4 WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 1 END)::int AS points,
      (COUNT(*) FILTER (WHERE place = 1))::int AS wins,
      (COUNT(*) FILTER (WHERE place <= 3))::int AS podiums,
      COUNT(*)::int AS races
    FROM race_results
    WHERE season = ${season} AND time_ms IS NOT NULL AND humans >= 2
    GROUP BY COALESCE(user_email, callsign)
    ORDER BY points DESC, wins DESC, podiums DESC, races DESC
    LIMIT 10`;
}

// Best clean lap per racer per track (any humans count — solo hot-laps count),
// top 5 per track for the season.
export async function getBestLaps(season) {
  await ensureRaceTable();
  return sql`
    SELECT track_id, name, best_lap_ms
    FROM (
      SELECT
        track_id,
        (array_agg(callsign ORDER BY created_at DESC))[1] AS name,
        MIN(best_lap_ms)::int AS best_lap_ms,
        ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY MIN(best_lap_ms) ASC) AS rn
      FROM race_results
      WHERE season = ${season} AND best_lap_ms IS NOT NULL
      GROUP BY track_id, COALESCE(user_email, callsign)
    ) ranked
    WHERE rn <= 5
    ORDER BY track_id ASC, best_lap_ms ASC`;
}
