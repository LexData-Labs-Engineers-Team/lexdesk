# Nebula Grand Prix — race arena

The realtime multiplayer race behind the hub's **Race** station. Clients
simulate their own ships; the *arena engine* arbitrates shared truth — roster,
lobby → countdown → race → podium lifecycle, the obstacle seed, live standings,
finish order — and simulates the **AI pilots** that top up the grid.

## Architecture (one engine, three hosts)

The engine is isomorphic JS at `src/components/home/race/raceEngine.mjs`.
It never touches a socket — hosts hand it per-client send callbacks:

| Host | When it runs | Transport |
| --- | --- | --- |
| `server.mjs` (app root, via `npm run dev` / `npm start`) | **default** | WebSocket at `/race-ws` on the app's own port |
| `race-server/server.mjs` (`npm run race:server`) | hosting the relay separately from the site | WebSocket on `:3990` (`RACE_PORT`) |
| `src/components/home/race/localArena.js` | no server reachable (e.g. Vercel) | in-page function calls — solo **practice vs AI**, zero network |

The client (`raceNet.js`) tries, in order: `NEXT_PUBLIC_RACE_WS_URL` →
same-origin `/race-ws` → `<hostname>:3990`, remembers what worked, and
auto-reconnects with backoff after a dropped link. A racer who reconnects
within 30 s (per-tab resume key) gets their seat, id, and progress back.

**Why same-port matters:** the old setup (separate process, second port) is
what broke multiplayer in practice — teammates could load the site on :3000
but Windows Firewall silently ate :3990, and the extra process was easy to
forget. If a player can load the page, they can now join the race.

## Run it

```bash
npm run dev          # site + arena on :3000 — nothing else to start
npm run race:test    # synthetic two-pilot lifecycle test (arm/race/resume/podium)
```

## Config

| Env var | Where | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | app server | `3000` | HTTP + WebSocket port |
| `RACE_PORT` | standalone relay | `3990` | WebSocket listen port |
| `NEXT_PUBLIC_RACE_WS_URL` | web client | *(unset)* | Full socket URL of a hosted relay. **Inlined at build time** — set it in the build environment, not at runtime. |

## Rules encoded in the engine

- The grid arms at **2+ pilots** (20 s countdown; all humans ready → 5 s;
  a pilot joining an armed grid re-floats the countdown to ≥ 8 s).
- **AI pilots** fill toward 4 on the grid while ≥ 1 human is present (6 in
  offline practice). Humans displace them; they never race an empty room.
  They hold the racing line inside the obstacle-free center lane, brake for
  corners, boost on straights, and rubber-band mildly around the lead human.
- **Three circuits** (Nebula Circuit / Ion Straits / Helix Falls) — the lobby
  votes; majority wins at launch, ties go to chance, silence keeps the
  current one. Track geometry lives in `trackData.mjs`.
- **Pickup pods** float off the racing line (kinds dealt from the race seed):
  *shield* absorbs one hit, *overcharge* raises the speed cap 6 s, *EMP*
  shocks every unshielded ship within 20u. First grab wins (engine
  arbitrates); pods respawn after 12 s.
- 8 ships max on a grid; later arrivals spectate until the next race.
- Finishes before GO — or without ~full track progress — are ignored, and
  progress that grows faster than a physically possible pace is clamped;
  podium holds ~14 s, then the next lobby opens.
- A race hard-caps at 6 minutes; stragglers get 75 s after the winner.
- Duplicate callsigns are de-duped server-side (`NAME·2`).
- A finisher who disconnects still keeps their podium row (and a racer who
  reconnects within 30 s resumes their seat mid-race).
- **Rooms**: `?race_room=<name>` on the page URL gives that link its own
  private arena (`?room=` on the socket); idle rooms free after a minute.

## Office GP (persistent leaderboard)

Finished online races post to `/api/race/result` (Bearer token when signed
in, anonymous by callsign otherwise; DNFs and sub-30s claims are dropped).
`/api/race/leaderboard` serves monthly-season standings (9-6-4-3-2-1-style
points, humans ≥ 2 races only) plus per-circuit lap records — shown in the
Race station panel and on the podium. Needs `DATABASE_URL` (the table
self-provisions on first use).

## Deploying multiplayer

Serverless hosts (Vercel) can't hold a WebSocket open — there the site
gracefully offers **solo practice vs AI** instead. For real multiplayer,
either self-host the whole app (`npm run build && npm start` — arena
included, one port) or run `race-server/server.mjs` on any Node box and
point `NEXT_PUBLIC_RACE_WS_URL` at it (`wss://` behind TLS).

### Deploy the relay (hosted kit)

`race-server/deploy/` is a ready-made kit for hosting the relay on
Railway / Render / Fly.io: a minimal Dockerfile (only `ws` + `three`),
per-host configs, and `server-with-health.mjs` — the relay plus a
`GET /healthz` → `200` endpoint, because PaaS health checks speak HTTP
and the bare relay is WebSocket-only. Start with
[`deploy/DEPLOY.md`](deploy/DEPLOY.md): ranked host options, the exact
Vercel `NEXT_PUBLIC_RACE_WS_URL` step (build-time — redeploy after
setting it), and a one-line `wscat` smoke test.
