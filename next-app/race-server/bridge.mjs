// Bridges real WebSockets to arena-engine seats — one engine per ROOM, spun up
// lazily and torn down when it has sat empty for a minute. Shared by the
// standalone relay (race-server/server.mjs), the health-wrapped deploy build,
// and the Next custom server (server.mjs at the app root, /race-ws).
// Lives apart from the CLI entries so importing it never starts a listener.
// Ping/pong liveness is handled here because it's a ws-transport concern —
// the engine itself is transport-agnostic.

import { createRaceEngine } from '../src/components/home/race/raceEngine.mjs';

const ROOM_IDLE_DISPOSE_MS = 60_000;

const roomName = (req) => {
  try {
    const raw = new URL(req?.url || '/', 'http://internal').searchParams.get('room') || '';
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  } catch {
    return '';
  }
};

export function attachEngineToSocketServer(socketServer, { log = () => {} } = {}) {
  const rooms = new Map(); // name -> { engine, seats, idleTimer }

  const getRoom = (name) => {
    let room = rooms.get(name);
    if (!room) {
      const tag = name ? `[${name}] ` : '';
      room = {
        engine: createRaceEngine({ log: (...a) => log(...a.map((x) => (typeof x === 'string' ? x.replace('[race]', `[race] ${tag}`.trimEnd()) : x))) }),
        seats: 0,
        idleTimer: null,
      };
      rooms.set(name, room);
      if (name) log(`[race] room "${name}" opened`);
    }
    clearTimeout(room.idleTimer);
    return room;
  };

  const releaseRoom = (name, room) => {
    room.seats -= 1;
    if (room.seats > 0) return;
    // Nobody left — give stragglers (reconnects, lingering racers) a minute,
    // then free the engine's timers. The default room stays warm forever.
    if (!name) return;
    clearTimeout(room.idleTimer);
    room.idleTimer = setTimeout(() => {
      if (room.seats <= 0 && room.engine.humanCount() === 0) {
        room.engine.dispose();
        rooms.delete(name);
        log(`[race] room "${name}" closed`);
      }
    }, ROOM_IDLE_DISPOSE_MS);
  };

  // One stringify per broadcast object, shared across all sockets.
  const encoded = new WeakMap();
  const encode = (obj) => {
    let raw = encoded.get(obj);
    if (!raw) { raw = JSON.stringify(obj); encoded.set(obj, raw); }
    return raw;
  };

  socketServer.on('connection', (ws, req) => {
    const name = roomName(req);
    const room = getRoom(name);
    room.seats += 1;
    const seat = room.engine.connect((obj) => {
      if (ws.readyState === 1) { try { ws.send(encode(obj)); } catch {} }
    });
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      seat.receive(m);
    });
    ws.on('close', () => {
      seat.close();
      releaseRoom(name, room);
    });
    ws.on('error', () => {});
  });

  // Reap dead connections so ghosts never hold a grid slot.
  const reaper = setInterval(() => {
    for (const ws of socketServer.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 15_000);
  socketServer.on('close', () => clearInterval(reaper));
}
