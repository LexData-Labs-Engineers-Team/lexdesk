// Nebula Grand Prix — realtime race relay for the TeamOS hub.
//
// A deliberately small, dependency-light WebSocket server. It is NOT a physics
// authority: every client simulates its own ship and streams position at
// ~12 Hz; this process relays snapshots to everyone else and arbitrates the
// things that must be shared truth — the roster, the race lifecycle (lobby →
// armed → racing → results), the obstacle seed, live standings, and the final
// finish order. Run alongside `next dev`:
//
//   npm run race:server        (port 3990, override with RACE_PORT)
//
// Browsers connect to ws://<host>:3990 — the client derives the URL from
// location.hostname, so LAN play works out of the box.

import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.RACE_PORT || '3990', 10);

const GRID_MAX = 8;              // ships on the grid; later arrivals spectate
const MIN_PILOTS = 2;            // the race will not arm below this
const ARM_MS = 20_000;           // countdown once the grid has 2+ pilots
const ALL_READY_MS = 5_000;      // countdown shortens to this when all are ready
const LAUNCH_LEAD_MS = 4_200;    // 3-2-1-GO window after "racing" begins
const RESULTS_MS = 14_000;       // podium hold before the next lobby
const FINISH_WINDOW_MS = 75_000; // stragglers get this long after P1 finishes
const RACE_CAP_MS = 6 * 60_000;  // absolute race duration cap
const SNAPSHOT_MS = 80;          // ~12.5 Hz position relay
const STANDINGS_MS = 500;        // live leaderboard cadence

const now = () => Date.now();

let nextId = 1;
const players = new Map(); // id -> player record

const room = {
  phase: 'lobby',        // lobby | armed | racing | results
  countdownEndsAt: null, // armed: when the launch fires
  startAt: null,         // racing: when control unlocks (GO)
  seed: 1,
  grid: [],              // player ids locked onto the grid for this race
  finishOrder: [],       // ids in finish order
  firstFinishAt: null,
  results: null,         // final rows shown on the podium
};

const wss = new WebSocketServer({ port: PORT });
console.log(`[race] Nebula Grand Prix server listening on :${PORT}`);

function send(ws, obj) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

function broadcast(obj, exceptId = null) {
  const raw = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === 1) {
      try { p.ws.send(raw); } catch {}
    }
  }
}

const clampNum = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const wrapAngle = (v) => (Number.isFinite(v) ? Math.atan2(Math.sin(v), Math.cos(v)) : 0);
const cleanName = (s) =>
  String(s ?? '').replace(/[^\w \-'.]/g, '').trim().slice(0, 14) || `PILOT-${Math.floor(100 + Math.random() * 900)}`;

function publicPlayer(p) {
  return { id: p.id, name: p.name, hue: p.hue, ready: p.ready, spectator: p.spectator, finished: p.finished, place: p.place };
}

function roster() {
  return [...players.values()].map(publicPlayer);
}

function gridPilots() {
  return [...players.values()].filter((p) => !p.spectator);
}

// Phase fields only — no message type, so callers can safely spread this into
// both 'phase' broadcasts and the 'welcome' payload without clobbering `t`.
function phaseFields() {
  return {
    phase: room.phase,
    countdownEndsAt: room.countdownEndsAt,
    startAt: room.startAt,
    seed: room.seed,
    grid: room.grid,
    results: room.results,
    now: now(),
  };
}

function phaseMsg() {
  return { t: 'phase', ...phaseFields() };
}

/* ------------------------------------------------------ lifecycle engine */

function armGrid() {
  room.phase = 'armed';
  room.countdownEndsAt = now() + ARM_MS;
  broadcast(phaseMsg());
}

function disarmGrid() {
  room.phase = 'lobby';
  room.countdownEndsAt = null;
  broadcast(phaseMsg());
}

function startRace() {
  room.phase = 'racing';
  room.seed = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
  room.startAt = now() + LAUNCH_LEAD_MS;
  room.countdownEndsAt = null;
  room.finishOrder = [];
  room.firstFinishAt = null;
  room.results = null;
  room.grid = gridPilots().slice(0, GRID_MAX).map((p) => p.id);
  for (const p of players.values()) {
    const racing = room.grid.includes(p.id);
    p.spectator = !racing;
    if (!racing) p.state = null; // stop relaying a demoted pilot's stale ship
    p.finished = false;
    p.place = null;
    p.timeMs = null;
    p.prog = 0;
    p.ready = false;
  }
  broadcast(phaseMsg());
  broadcast({ t: 'roster', players: roster() });
  console.log(`[race] launch — ${room.grid.length} pilots, seed ${room.seed}`);
}

function endRace() {
  room.phase = 'results';
  room.countdownEndsAt = now() + RESULTS_MS;
  const rows = room.grid
    .map((id) => players.get(id))
    .filter(Boolean)
    .map((p) => ({
      id: p.id, name: p.name, hue: p.hue,
      place: p.place, timeMs: p.timeMs,
      dnf: !p.finished,
      prog: p.prog,
    }));
  // Finishers by place, then DNFs by how far they got.
  rows.sort((a, b) => (a.dnf === b.dnf ? (a.dnf ? b.prog - a.prog : a.place - b.place) : a.dnf ? 1 : -1));
  room.results = rows;
  broadcast(phaseMsg());
  console.log(`[race] finished — podium: ${rows.filter((r) => !r.dnf).slice(0, 3).map((r) => r.name).join(', ') || 'none'}`);
}

function toLobby() {
  room.phase = 'lobby';
  room.countdownEndsAt = null;
  room.startAt = null;
  room.results = null;
  room.grid = [];
  for (const p of players.values()) {
    p.spectator = false; // everyone waiting gets a grid slot next round
    p.ready = false;
    p.finished = false;
    p.place = null;
    p.timeMs = null;
    p.prog = 0;
  }
  broadcast(phaseMsg());
  broadcast({ t: 'roster', players: roster() });
}

setInterval(() => {
  const t = now();
  const grid = gridPilots();

  if (room.phase === 'lobby' && grid.length >= MIN_PILOTS) armGrid();

  if (room.phase === 'armed') {
    if (grid.length < MIN_PILOTS) return disarmGrid();
    const allReady = grid.length >= MIN_PILOTS && grid.every((p) => p.ready);
    if (allReady && room.countdownEndsAt - t > ALL_READY_MS) {
      room.countdownEndsAt = t + ALL_READY_MS;
      broadcast(phaseMsg());
    }
    if (t >= room.countdownEndsAt) startRace();
  }

  if (room.phase === 'racing') {
    const racers = room.grid.map((id) => players.get(id)).filter(Boolean);
    const allDone = racers.length > 0 && racers.every((p) => p.finished);
    const windowOver = room.firstFinishAt && t - room.firstFinishAt > FINISH_WINDOW_MS;
    const capOver = room.startAt && t - room.startAt > RACE_CAP_MS;
    if (racers.length === 0) return toLobby(); // everyone left mid-race
    if (allDone || windowOver || capOver) endRace();
  }

  if (room.phase === 'results' && t >= room.countdownEndsAt) toLobby();
}, 250);

/* --------------------------------------------------------- data relays */

// Position snapshots — compact arrays, only while there is motion to share.
setInterval(() => {
  if (players.size < 2) return;
  const ps = [];
  for (const p of players.values()) {
    if (!p.state) continue;
    const s = p.state;
    ps.push([p.id, s.x, s.y, s.z, s.h, s.k, s.s, s.b ? 1 : 0, p.prog, p.lap ?? 0]);
  }
  if (ps.length) broadcast({ t: 'snap', ps, now: now() });
}, SNAPSHOT_MS);

// Live standings while racing.
setInterval(() => {
  if (room.phase !== 'racing') return;
  const rows = room.grid
    .map((id) => players.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, prog: p.prog, finished: p.finished, place: p.place, timeMs: p.timeMs }))
    .sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.prog - a.prog;
    });
  broadcast({ t: 'standings', rows });
}, STANDINGS_MS);

/* ------------------------------------------------------------ sockets */

wss.on('connection', (ws) => {
  let me = null;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    // Lightweight status probe used by the hub's station panel.
    if (m.t === 'peek') {
      send(ws, {
        t: 'peekInfo',
        pilots: players.size,
        phase: room.phase,
      });
      return;
    }

    if (m.t === 'hello') {
      if (me) return; // already registered on this socket — ignore repeat hellos
      me = {
        id: nextId++,
        ws,
        name: cleanName(m.name),
        hue: clampNum(m.hue, 0, 359) | 0,
        ready: false,
        // Joining mid-race means spectating until the podium clears.
        spectator: room.phase === 'racing' || room.phase === 'results',
        finished: false,
        place: null,
        timeMs: null,
        prog: 0,
        lap: 0,
        state: null,
      };
      players.set(me.id, me);
      send(ws, {
        t: 'welcome',
        id: me.id,
        spectator: me.spectator,
        players: roster(),
        ...phaseFields(),
      });
      broadcast({ t: 'join', player: publicPlayer(me) }, me.id);
      console.log(`[race] + ${me.name} (#${me.id}) — ${players.size} online`);
      return;
    }

    if (!me) return; // everything below requires a hello first

    switch (m.t) {
      case 'profile': {
        if (m.name !== undefined) me.name = cleanName(m.name);
        if (m.hue !== undefined) me.hue = clampNum(m.hue, 0, 359) | 0;
        broadcast({ t: 'player', player: publicPlayer(me) });
        break;
      }
      case 'ready': {
        me.ready = !!m.on;
        broadcast({ t: 'player', player: publicPlayer(me) });
        break;
      }
      case 'state': {
        me.state = {
          x: clampNum(m.x, -500, 500), y: clampNum(m.y, -50, 120), z: clampNum(m.z, -500, 500),
          // wrap (not clamp) the heading — clamping a value that legitimately
          // winds past ±2π over laps would freeze the ship's yaw for everyone.
          h: wrapAngle(m.h), k: clampNum(m.k, -1.2, 1.2),
          s: clampNum(m.s, -20, 60), b: !!m.b,
        };
        if (room.phase === 'racing' && !me.spectator && !me.finished) {
          me.prog = clampNum(m.prog, 0, 10_000);
          me.lap = clampNum(m.lap, 0, 50) | 0;
        }
        break;
      }
      case 'finish': {
        if (room.phase !== 'racing' || me.spectator || me.finished) break;
        if (now() < room.startAt) break; // nobody finishes before GO
        me.finished = true;
        me.place = room.finishOrder.push(me.id);
        me.timeMs = now() - room.startAt;
        if (!room.firstFinishAt) room.firstFinishAt = now();
        broadcast({ t: 'finished', id: me.id, name: me.name, place: me.place, timeMs: me.timeMs });
        console.log(`[race] ${me.name} finished P${me.place} in ${(me.timeMs / 1000).toFixed(1)}s`);
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    players.delete(me.id);
    broadcast({ t: 'leave', id: me.id });
    console.log(`[race] - ${me.name} (#${me.id}) — ${players.size} online`);
  });
  ws.on('error', () => {});
});

// Reap dead connections so ghosts never hold a grid slot.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15_000);
