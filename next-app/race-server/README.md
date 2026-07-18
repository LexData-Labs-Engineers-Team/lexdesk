# Nebula Grand Prix — race server

The realtime relay behind the hub's **Race** station (multiplayer space race).
Clients simulate their own ships; this process relays position snapshots and
arbitrates the shared truth — roster, lobby → countdown → race → podium
lifecycle, the obstacle seed, live standings, and finish order.

## Run it

```bash
npm run race:server        # listens on ws://0.0.0.0:3990
```

Run it alongside `npm run dev`. The web client derives the socket URL from
`location.hostname`, so teammates on your LAN can race you at
`http://<your-ip>:3000` with no extra config.

## Config

| Env var | Where | Default | Purpose |
| --- | --- | --- | --- |
| `RACE_PORT` | server | `3990` | WebSocket listen port |
| `NEXT_PUBLIC_RACE_WS_URL` | web client | `ws(s)://<hostname>:3990` | Full socket URL override (needed when deploying behind a proxy/host) |

## Rules encoded here

- The grid arms at **2+ pilots** (20 s countdown; everyone ready → 5 s).
- 8 ships max on a grid; later arrivals spectate until the next race.
- Finishes before GO are ignored; podium holds ~14 s, then the next lobby opens.
- A race hard-caps at 6 minutes; stragglers get 75 s after the winner.

Note: serverless hosts (e.g. Vercel) can't run this process — the site degrades
gracefully (the Race panel shows "arena offline"). Host it on any Node-capable
box and point `NEXT_PUBLIC_RACE_WS_URL` at it.
