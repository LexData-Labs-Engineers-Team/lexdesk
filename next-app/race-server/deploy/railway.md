# Railway — deploy the race relay (easiest path)

1. Push the repo to GitHub, then on railway.app: **New Project → Deploy from GitHub repo**.
2. Service **Settings → Source → Root Directory**: set to `next-app` (the Docker build context must contain both `race-server/` and `src/`).
3. Service **Settings → Build → Dockerfile Path**: set to `race-server/deploy/Dockerfile` (or add the service variable `RAILWAY_DOCKERFILE_PATH=race-server/deploy/Dockerfile` — same effect).
4. Deploy. Railway builds the image and injects `PORT`; `server-with-health.mjs` binds it automatically — no port config needed.
5. **Settings → Networking → Generate Domain** and accept the detected port. You get `https://<name>.up.railway.app` with TLS included.
6. Your relay URL is the same host with the `wss://` scheme: `wss://<name>.up.railway.app`.
7. Smoke-test: `npx wscat -c wss://<name>.up.railway.app`, type `{"t":"peek"}`, expect a `{"t":"peekInfo",...}` reply.
8. Point the site at it: set `NEXT_PUBLIC_RACE_WS_URL=wss://<name>.up.railway.app` in Vercel and **redeploy** — full steps in `DEPLOY.md`.

Notes: no idle spin-down and first-class WebSocket support, which is why it ranks first. Cost: no permanent free tier — the one-time trial credit runs this tiny relay for roughly a month; after that the Hobby plan is $5/mo (this image idles at ~50 MB RAM, so usage-based cost is minimal).
