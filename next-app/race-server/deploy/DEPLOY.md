# Deploying the Nebula Grand Prix relay

The relay is a tiny stateless Node WebSocket server — no database, no disk,
only two npm deps (`ws`, `three`). Host it anywhere Node or Docker runs, then
point the Vercel site at it with one env var. Everything in this folder is
that kit:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Minimal `node:22-alpine` image (build context = `next-app/`) |
| `package.json` | Standalone manifest — `ws` + `three` pinned, nothing else |
| `server-with-health.mjs` | Image entrypoint: the relay **plus** `GET /healthz` → `200 ok`, because PaaS health checks speak HTTP and the bare relay (`../server.mjs`) is WebSocket-only |
| `railway.md` | Railway walkthrough (option 1) |
| `render.yaml` | Render blueprint (option 2) |
| `fly.toml` | Fly.io config (option 3) |

The entrypoint binds `RACE_PORT`, else the platform-injected `PORT`, else
`3990` — so it "just works" on all three hosts. All three terminate TLS for
you, so the browser's `wss://` requirement is covered with zero config.

## Pick a host (ranked)

1. **Railway — easiest.** Connect the GitHub repo, set two settings, done.
   Auto-detects the Dockerfile, injects `PORT`, no idle spin-down,
   WebSocket-friendly. Not permanently free (trial credit, then ~$5/mo).
   → `railway.md`
2. **Render — actually free.** Free web service tier runs Docker + WebSockets
   fine, but spins down after ~15 min idle: the first racer after a quiet
   spell waits ~30–60 s for cold start (the site falls back to solo practice
   until it wakes). → `render.yaml` (copy to the **repo root** or mirror its
   settings by hand in the dashboard)
3. **Fly.io — cheapest always-on.** ~$2–3/mo for a 256 MB machine with
   `auto_stop` off, CLI-driven deploys, pick a region near your players.
   → `fly.toml`

## Build the image locally (optional sanity check)

Run from `next-app/` — the build context must contain `race-server/` **and**
`src/` (the relay imports the engine from
`src/components/home/race/raceEngine.mjs`):

```bash
cd next-app
docker build -f race-server/deploy/Dockerfile -t nebula-race-relay .
docker run --rm -p 3990:3990 nebula-race-relay
```

No Docker? The health-wrapped entrypoint also runs in place against the
app's own `node_modules`:

```bash
cd next-app
node race-server/deploy/server-with-health.mjs
```

## Point Vercel at the relay (the step people miss)

`NEXT_PUBLIC_RACE_WS_URL` is **inlined into the client bundle at build
time** — setting it does nothing until the site is rebuilt.

1. Vercel dashboard → your project → **Settings → Environment Variables**.
2. Add `NEXT_PUBLIC_RACE_WS_URL` = `wss://<your-relay-host>` (no path needed;
   the relay accepts the upgrade on any path). Apply to **Production** (and
   Preview if you want preview deploys racing too).
3. **Redeploy** the site (Deployments → ⋯ → Redeploy). A deploy that ran
   before the variable existed does not have it baked in.

The client tries this URL first, then falls back to same-origin `/race-ws`,
then `<hostname>:3990` — so a wrong or dead relay URL degrades gracefully to
solo practice instead of breaking the page.

## Smoke test

The engine answers a `peek` probe on any fresh socket — no join required:

```bash
npx wscat -c wss://<your-relay-host>
> {"t":"peek"}
< {"t":"peekInfo","pilots":0,"humans":0,"bots":0,"phase":"lobby"}
```

Or as a script (uses the `ws` already in the app's node_modules):

```js
// smoke.mjs — run: node smoke.mjs wss://<your-relay-host>
import { WebSocket } from 'ws';
const ws = new WebSocket(process.argv[2]);
ws.on('open', () => ws.send(JSON.stringify({ t: 'peek' })));
ws.on('message', (raw) => { console.log('reply:', raw.toString()); ws.close(); });
ws.on('error', (e) => { console.error('failed:', e.message); process.exit(1); });
```

A `peekInfo` reply proves the whole chain: DNS, TLS, the WebSocket upgrade,
and the engine loop. Then load the Vercel site — the Race station should
show the live grid instead of "practice vs AI".
