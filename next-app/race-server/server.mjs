// Nebula Grand Prix — standalone WebSocket relay.
//
// You only need this process when hosting the relay somewhere other than the
// Next server itself — the default `npm run dev` / `npm start` already mount
// the same arena engine on the app's own port at /race-ws. Point browsers at
// this one with NEXT_PUBLIC_RACE_WS_URL (e.g. wss://race.example.com).
//
//   npm run race:server        (port 3990, override with RACE_PORT)

import { WebSocketServer } from 'ws';
import { createRaceEngine } from '../src/components/home/race/raceEngine.mjs';
import { attachEngineToSocketServer } from './bridge.mjs';

const PORT = parseInt(process.env.RACE_PORT || '3990', 10);

const engine = createRaceEngine({ log: console.log });
const wss = new WebSocketServer({ port: PORT });
wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[race] port ${PORT} is already in use — a stale relay may still be running (netstat -ano | findstr :${PORT}).`);
    process.exit(1);
  }
  throw err;
});
attachEngineToSocketServer(engine, wss);
console.log(`[race] Nebula Grand Prix relay listening on :${PORT}`);
