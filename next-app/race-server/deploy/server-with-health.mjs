// Nebula Grand Prix — hosted relay with an HTTP health endpoint.
//
// Same arena engine as ../server.mjs, but the WebSocketServer piggybacks on a
// plain Node http server so platform health checks (Render, Railway, Fly.io)
// get a real 200 from GET /healthz instead of an upgrade-only socket that
// looks dead to them. This is the entrypoint the Docker image runs.
//
// Imports are relative to THIS file's on-disk location (race-server/deploy/),
// and the Dockerfile copies the tree preserving that layout — so the same
// file runs unchanged both locally and in the image:
//
//   node race-server/deploy/server-with-health.mjs   (from next-app/)
//
// Port: RACE_PORT wins if set, else the platform's injected PORT, else 3990.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { attachEngineToSocketServer } from '../bridge.mjs';

const PORT = parseInt(process.env.RACE_PORT || process.env.PORT || '3990', 10);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[race] port ${PORT} is already in use — a stale relay may still be running.`);
    process.exit(1);
  }
  throw err;
});

// Attach to the http server (not a port) so ws upgrades and health checks
// share one listener; upgrade is accepted on any path, so wss://<host> works.
// The bridge spins one arena per ?room= query (default room otherwise).
const wss = new WebSocketServer({ server });
attachEngineToSocketServer(wss, { log: console.log });

server.listen(PORT, () => {
  console.log(`[race] Nebula Grand Prix relay (ws + GET /healthz) listening on :${PORT}`);
});
