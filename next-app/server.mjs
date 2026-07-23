// TeamOS app server — Next.js plus the Nebula Grand Prix arena on ONE port.
//
// Why a custom server: the race needs a WebSocket relay, and running it as a
// separate process on a second port (the old :3990 setup) broke multiplayer in
// practice — teammates' machines could reach the site on :3000 but Windows
// Firewall (or any host's port rules) silently blocked the extra port, and the
// second process was easy to forget entirely. Mounting the relay on the app's
// own port at /race-ws means: one command, one port, LAN play works the moment
// the site itself is reachable.
//
//   npm run dev     → this file, dev mode (Turbopack HMR upgrades pass through)
//   npm start       → this file, production mode (after `npm run build`)
//   Vercel          → ignores this file (serverless); the race panel degrades
//                     to solo AI practice unless NEXT_PUBLIC_RACE_WS_URL points
//                     at a hosted relay (see race-server/README.md).
//
// NOTE (repo convention): per AGENTS.md this project's Next build is
// non-standard — custom-server behavior verified against
// node_modules/next/dist/docs/01-app/02-guides/custom-server.md.

if (process.argv.includes('--prod')) process.env.NODE_ENV = 'production';

const { createServer } = await import('node:http');
const { WebSocketServer } = await import('ws');
const next = (await import('next')).default;
const { createRaceEngine } = await import('./src/components/home/race/raceEngine.mjs');
const { attachEngineToSocketServer } = await import('./race-server/bridge.mjs');

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev, hostname: '0.0.0.0', port });
const handle = app.getRequestHandler();

await app.prepare();
// NOTE: must come after prepare() — this Next build throws if the upgrade
// handler is requested before the internal server exists.
const handleUpgrade = app.getUpgradeHandler();

const server = createServer((req, res) => handle(req, res));

// The arena engine + a no-listener WebSocket server fed by manual upgrades.
const engine = createRaceEngine({ log: console.log });
const raceWss = new WebSocketServer({ noServer: true });
attachEngineToSocketServer(engine, raceWss);

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://internal').pathname; } catch {}
  if (pathname === '/race-ws') {
    raceWss.handleUpgrade(req, socket, head, (ws) => raceWss.emit('connection', ws, req));
  } else {
    // Everything else (Turbopack HMR in dev, etc.) belongs to Next.
    handleUpgrade(req, socket, head);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Windows note: killing an `npm run dev` wrapper can leave the node child
    // alive holding the port — find it with `netstat -ano | findstr :3000`.
    console.error(`[server] port ${port} is already in use — is another dev server still running?`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log(`> TeamOS ready on http://localhost:${port} (${dev ? 'dev' : 'production'})`);
  console.log(`> Nebula Grand Prix arena mounted at ws://localhost:${port}/race-ws`);
});
