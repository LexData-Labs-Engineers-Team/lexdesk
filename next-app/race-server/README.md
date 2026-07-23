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
- 8 ships max on a grid; later arrivals spectate until the next race.
- Finishes before GO — or without ~full track progress — are ignored;
  podium holds ~14 s, then the next lobby opens.
- A race hard-caps at 6 minutes; stragglers get 75 s after the winner.
- Duplicate callsigns are de-duped server-side (`NAME·2`).
- A finisher who disconnects still keeps their podium row.

## Deploying multiplayer

Serverless hosts (Vercel) can't hold a WebSocket open — there the site
gracefully offers **solo practice vs AI** instead. For real multiplayer,
either self-host the whole app (`npm run build && npm start` — arena
included, one port) or run `race-server/server.mjs` on any Node box and
point `NEXT_PUBLIC_RACE_WS_URL` at it (`wss://` behind TLS).
