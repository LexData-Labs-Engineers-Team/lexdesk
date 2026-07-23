// Nebula Grand Prix — the arena engine, isomorphic between Node and the browser.
//
// This module owns everything that must be shared truth for a race: the roster,
// the lifecycle (lobby → armed → racing → results), the obstacle seed, live
// standings, the finish order — and the AI pilots that keep a grid alive when
// there aren't enough humans. It is transport-agnostic: callers hand it a
// per-client send function and pump decoded messages back in.
//
//   const engine = createRaceEngine({ log: console.log });
//   const seat = engine.connect((msg) => deliverToClient(msg));
//   seat.receive(parsedMessageFromClient);
//   seat.close();
//
// Two hosts use it:
//   race-server/server.mjs   — bridges real WebSockets (LAN / hosted relay)
//   next-app/server.mjs      — same bridge mounted on the Next server itself
//                              at /race-ws, so multiplayer shares port 3000
//   localArena.js            — runs it INSIDE the browser for offline practice
//                              against the AI, no server required at all
//
// Clients simulate their own ships and stream state at ~12 Hz; the engine
// relays snapshots and arbitrates. AI pilots are simulated here (the engine is
// their authority), publishing the same state shape humans do, so clients
// render them with zero special-casing.

import { getTrack, GATE_COUNT, LAPS, TRACK_COUNT, dealPickupKinds } from './trackData.mjs';

export const GRID_MAX = 8;              // ships on the grid; later arrivals spectate
export const MIN_PILOTS = 2;            // the race will not arm below this
const ARM_MS = 20_000;                  // countdown once the grid has 2+ pilots
const ALL_READY_MS = 5_000;             // countdown shortens to this when all are ready
const LAUNCH_LEAD_MS = 4_200;           // 3-2-1-GO window after "racing" begins
const RESULTS_MS = 14_000;              // podium hold before the next lobby
const FINISH_WINDOW_MS = 75_000;        // stragglers get this long after P1 finishes
const RACE_CAP_MS = 6 * 60_000;         // absolute race duration cap
const SNAPSHOT_MS = 80;                 // ~12.5 Hz position relay + AI sim tick
const STANDINGS_MS = 500;               // live leaderboard cadence

// AI pilots: the grid tops up toward BOT_TARGET while at least one human is
// present, so a lone pilot always has a race. Humans displace bots one-for-one.
const BOT_TARGET = 4;
const BOT_NAMES = ['NOVA', 'QUASAR', 'ORION', 'VEGA', 'LYRA', 'CYGNUS', 'ALTAIR', 'RIGEL'];
const BOT_HUES = [16, 96, 210, 275, 48, 156, 330, 190];

const clampNum = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const wrapAngle = (v) => (Number.isFinite(v) ? Math.atan2(Math.sin(v), Math.cos(v)) : 0);
const cleanName = (s) =>
  String(s ?? '').replace(/[^\w \-'.·]/g, '').trim().slice(0, 14) || `PILOT-${Math.floor(100 + Math.random() * 900)}`;

export function createRaceEngine({ bots = {}, log = () => {} } = {}) {
  const botCfg = { enabled: bots.enabled !== false, target: bots.target ?? BOT_TARGET };
  const now = () => Date.now();

  let nextId = 1;
  const players = new Map(); // id -> player record (humans have .send, bots have .brain)

  const room = {
    phase: 'lobby',        // lobby | armed | racing | results
    countdownEndsAt: null, // armed: when the launch fires
    startAt: null,         // racing: when control unlocks (GO)
    seed: 1,
    trackId: 0,            // which circuit — decided by lobby vote at launch
    grid: [],              // player ids locked onto the grid for this race
    finishOrder: [],       // ids in finish order
    firstFinishAt: null,
    results: null,         // final rows shown on the podium
    // Podium rows captured the moment each pilot finishes — so a finisher who
    // disconnects before the flag still appears in the results (they earned it).
    finishedRows: new Map(),
    // Pickup pods: kinds dealt from the seed at launch; takenUntil timestamps
    // gate re-grabs (0 = available).
    pickupKinds: [],
    pickupTakenUntil: [],
  };

  const PICKUP_RESPAWN_MS = 12_000;

  const LINGER_MS = 30_000;      // grace for a mid-race disconnect to resume
  const ARMED_JOIN_FLOOR_MS = 8_000; // late joiner always gets >= this much countdown

  function publicPlayer(p) {
    return { id: p.id, name: p.name, hue: p.hue, ready: p.ready, spectator: p.spectator, finished: p.finished, place: p.place, bot: !!p.bot, vote: p.voteTrack ?? null };
  }

  const roster = () => [...players.values()].map(publicPlayer);
  const gridPilots = () => [...players.values()].filter((p) => !p.spectator);
  const humans = () => [...players.values()].filter((p) => !p.bot);

  function send(p, obj) {
    if (p.send) { try { p.send(obj); } catch {} }
  }

  function broadcast(obj, exceptId = null) {
    for (const p of players.values()) {
      if (p.id === exceptId) continue;
      send(p, obj);
    }
  }

  // Callsigns stay unique so the roster and podium never show two identical
  // names (two teammates with the default first-name callsign, or two bots).
  function uniqueName(want, selfId) {
    const taken = (n) => [...players.values()].some((p) => p.id !== selfId && p.name.toLowerCase() === n.toLowerCase());
    if (!taken(want)) return want;
    for (let i = 2; i < 100; i++) {
      const suffixed = `${want.slice(0, 14 - String(i).length - 1)}·${i}`;
      if (!taken(suffixed)) return suffixed;
    }
    return `${want.slice(0, 10)}-${Math.floor(100 + Math.random() * 900)}`;
  }

  // Phase fields only — no message type, so callers can safely spread this into
  // both 'phase' broadcasts and the 'welcome' payload without clobbering `t`.
  function phaseFields() {
    return {
      phase: room.phase,
      countdownEndsAt: room.countdownEndsAt,
      startAt: room.startAt,
      seed: room.seed,
      trackId: room.trackId,
      grid: room.grid,
      results: room.results,
      pickups: room.pickupTakenUntil,
      now: now(),
    };
  }

  const phaseMsg = () => ({ t: 'phase', ...phaseFields() });

  /* ---------------------------------------------------------- AI pilots */

  // Always read the ROOM's circuit — the lobby vote can change it per race.
  const curTrack = () => getTrack(room.trackId);

  function spawnBot() {
    const usedNames = new Set([...players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !usedNames.has(n)) || uniqueName(BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], -1);
    const idx = BOT_NAMES.indexOf(name.split('·')[0]);
    const bot = {
      id: nextId++,
      bot: true,
      send: null,
      name,
      hue: BOT_HUES[idx >= 0 ? idx : Math.floor(Math.random() * BOT_HUES.length)],
      ready: true, // bots never gate the all-ready countdown shortcut
      spectator: false,
      finished: false,
      place: null,
      timeMs: null,
      prog: 0,
      lap: 0,
      state: null,
      brain: {
        dist: Math.random() * curTrack().length, // signed distance along the circuit
        lat: 0,
        latPhase: Math.random() * Math.PI * 2,
        latFreq: 2 + Math.random() * 3,
        speed: 11,
        base: 30 + Math.random() * 5.5,       // per-bot skill ceiling (humans peak ~41+boost)
        reaction: 150 + Math.random() * 420,  // ms of launch hesitation after GO
        heading: 0,
        boostUntil: 0,
        mode: 'cruise',                       // cruise | grid | race
      },
    };
    players.set(bot.id, bot);
    broadcast({ t: 'join', player: publicPlayer(bot) });
    log(`[race] + ${bot.name} (AI) — ${players.size} online`);
    return bot;
  }

  function removeBot(bot) {
    players.delete(bot.id);
    broadcast({ t: 'leave', id: bot.id });
    log(`[race] - ${bot.name} (AI) — ${players.size} online`);
  }

  // Top the lobby grid up toward the target while humans are around; drain it
  // when they leave or the grid is crowded. Only ever touches lobby/armed —
  // a live race keeps its field.
  function ensureBots() {
    if (room.phase !== 'lobby' && room.phase !== 'armed') return;
    const humanCount = humans().length;
    const desired = botCfg.enabled && humanCount >= 1
      ? Math.max(0, Math.min(botCfg.target, GRID_MAX) - humanCount)
      : 0;
    const current = [...players.values()].filter((p) => p.bot);
    for (let i = current.length; i < desired; i++) spawnBot();
    for (let i = current.length - 1; i >= desired; i--) removeBot(current[i]);
  }

  // One simulation step for every AI pilot. Runs on the snapshot tick, so bot
  // motion lands in the same relay cadence as human state uplinks.
  function stepBots(dt) {
    const t0 = now();
    const track = curTrack();
    const leaderProg = Math.max(0, ...humans().filter((h) => !h.spectator && !h.finished).map((h) => h.prog || 0));
    for (const p of players.values()) {
      if (!p.bot) continue;
      const b = p.brain;

      if (room.phase === 'racing' && room.grid.includes(p.id)) {
        const sinceGo = t0 - room.startAt;
        if (sinceGo < b.reaction) {
          // Holding formation on the grid until GO (plus a human-like reaction beat).
          if (b.mode !== 'grid') {
            b.mode = 'grid';
            const gi = room.grid.indexOf(p.id);
            b.dist = -(7 + Math.floor(gi / 2) * 5.5);
            b.speed = 0;
            b.lat = (gi % 2 === 0 ? -1 : 1) * 2.6;
          }
        } else if (!p.finished) {
          b.mode = 'race';
          // Corner-aware target speed: read the tangent a beat ahead and slow
          // into disagreement between "here" and "there".
          const tNow = ((b.dist / track.length) % 1 + 1) % 1;
          const ahead = (tNow + 14 / track.length) % 1;
          const sNow = track.samples[Math.floor(tNow * track.samples.length) % track.samples.length];
          const sAhead = track.samples[Math.floor(ahead * track.samples.length) % track.samples.length];
          const straightness = Math.max(0, sNow.tan.dot(sAhead.tan)); // 1 = straight
          let target = b.base * (0.72 + 0.28 * straightness);
          // Mild rubber-band around the lead human so races stay races, not processions.
          if (leaderProg > 0) {
            const lead = (p.prog || 0) - leaderProg; // in gates
            target *= clampNum(1 - lead * 0.018, 0.88, 1.1);
          }
          // Bots burn boost on long straights, like everyone else.
          if (straightness > 0.995 && b.speed > b.base * 0.85 && t0 > b.boostUntil + 6000) b.boostUntil = t0 + 1400;
          const boosting = t0 < b.boostUntil;
          if (boosting) target += 5;
          b.speed += (target - b.speed) * Math.min(1, dt * (b.speed < target ? 0.9 : 2.2));
          b.dist += b.speed * dt;

          p.lap = Math.max(0, Math.floor(b.dist / track.length));
          p.prog = Math.max(0, (b.dist / track.length) * GATE_COUNT);
          if (b.dist >= LAPS * track.length && !p.finished) {
            p.finished = true;
            p.place = room.finishOrder.push(p.id);
            p.timeMs = t0 - room.startAt;
            if (!room.firstFinishAt) room.firstFinishAt = t0;
            room.finishedRows.set(p.id, { id: p.id, name: p.name, hue: p.hue, bot: true, place: p.place, timeMs: p.timeMs, dnf: false, prog: p.prog });
            broadcast({ t: 'finished', id: p.id, name: p.name, place: p.place, timeMs: p.timeMs });
            log(`[race] ${p.name} (AI) finished P${p.place} in ${(p.timeMs / 1000).toFixed(1)}s`);
          }
        } else {
          // Finished: cruise out the podium wait.
          b.mode = 'cruise';
          b.speed += (13 - b.speed) * Math.min(1, dt * 1.2);
          b.dist += b.speed * dt;
        }
      } else {
        // Lobby / spectating bots idle around the circuit so the arena feels alive.
        b.mode = 'cruise';
        b.speed += (13 - b.speed) * Math.min(1, dt * 1.2);
        b.dist += b.speed * dt;
      }

      // Racing-line wander stays inside the breathable center lane (< ±4u,
      // where genObstacles never places rocks), so bots don't ghost through
      // asteroids they can't see.
      b.latPhase += dt * 0.45;
      const wantLat = b.mode === 'grid' ? b.lat : Math.sin(b.latPhase * b.latFreq) * 3.2;
      b.lat += (wantLat - b.lat) * Math.min(1, dt * 1.6);

      const tParam = ((b.dist / track.length) % 1 + 1) % 1;
      const pos = track.curve.getPointAt(tParam);
      const tan = track.curve.getTangentAt(tParam);
      // lateral = tangent × up on the track plane (matches trackData's nrm)
      const nx = tan.z, nz = -tan.x; // cross([tx,ty,tz],[0,1,0]) → (tz, 0, -tx), normalized below
      const nl = Math.hypot(nx, nz) || 1;
      const heading = Math.atan2(tan.x, tan.z);
      const turn = wrapAngle(heading - b.heading);
      b.heading = heading;
      p.state = {
        x: pos.x + (nx / nl) * b.lat,
        y: pos.y + 0.4 + Math.sin(b.latPhase * 2.1) * 0.25,
        z: pos.z + (nz / nl) * b.lat,
        h: heading,
        k: clampNum(dt > 0 ? (turn / dt) * 0.35 : 0, -1.1, 1.1),
        s: b.speed,
        b: t0 < b.boostUntil,
      };
    }
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
    // Clear human ready flags: a stale READY from the aborted grid would
    // instantly shrink the next countdown to the all-ready 5s and launch a
    // fresh joiner before they've even seen the lobby.
    for (const p of players.values()) if (!p.bot && p.ready) { p.ready = false; broadcast({ t: 'player', player: publicPlayer(p) }); }
    broadcast(phaseMsg());
  }

  // The grid votes on the next circuit; majority wins, ties go to chance,
  // silence keeps the current one.
  function tallyTrackVote() {
    const votes = [...players.values()]
      .filter((p) => !p.bot && !p.spectator && Number.isInteger(p.voteTrack))
      .map((p) => p.voteTrack);
    if (!votes.length) return room.trackId;
    const counts = new Map();
    for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
    const top = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, c]) => c === top).map(([t]) => t);
    return leaders[Math.floor(Math.random() * leaders.length)];
  }

  function startRace() {
    room.phase = 'racing';
    room.seed = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
    room.trackId = tallyTrackVote();
    room.startAt = now() + LAUNCH_LEAD_MS;
    room.countdownEndsAt = null;
    room.finishOrder = [];
    room.firstFinishAt = null;
    room.results = null;
    room.finishedRows.clear();
    room.pickupKinds = dealPickupKinds(room.seed, room.trackId);
    room.pickupTakenUntil = room.pickupKinds.map(() => 0);
    // Humans take grid slots first; bots fill what's left.
    const pilots = gridPilots().sort((a, b) => (a.bot === b.bot ? 0 : a.bot ? 1 : -1));
    room.grid = pilots.slice(0, GRID_MAX).map((p) => p.id);
    for (const p of players.values()) {
      const racing = room.grid.includes(p.id);
      p.spectator = !racing;
      if (!racing) p.state = null; // stop relaying a demoted pilot's stale ship
      p.finished = false;
      p.place = null;
      p.timeMs = null;
      p.prog = 0;
      p.lap = 0;
      p.ready = p.bot ? true : false;
      p.voteTrack = null; // votes are per-race
      p._progAt = null;
      p._progStrikes = 0;
      if (p.bot) p.brain.mode = 'cruise'; // re-pinned to the grid on first race tick
    }
    // Roster first (who is racing vs spectating), THEN the phase flip — so no
    // client ever renders phase='racing' while still believing it has a grid slot.
    broadcast({ t: 'roster', players: roster() });
    broadcast(phaseMsg());
    log(`[race] launch — ${room.grid.length} pilots, seed ${room.seed}`);
  }

  function endRace() {
    room.phase = 'results';
    room.countdownEndsAt = now() + RESULTS_MS;
    const rows = room.grid
      .map((id) => {
        const p = players.get(id);
        if (p) return {
          id: p.id, name: p.name, hue: p.hue, bot: !!p.bot,
          place: p.place, timeMs: p.timeMs,
          dnf: !p.finished,
          prog: p.prog,
        };
        // Disconnected before the podium — but if they crossed the line first,
        // the row captured at their finish keeps their result on the board.
        return room.finishedRows.get(id) ?? null;
      })
      .filter(Boolean);
    // Finishers by place, then DNFs by how far they got.
    rows.sort((a, b) => (a.dnf === b.dnf ? (a.dnf ? b.prog - a.prog : a.place - b.place) : a.dnf ? 1 : -1));
    room.results = rows;
    broadcast(phaseMsg());
    log(`[race] finished — podium: ${rows.filter((r) => !r.dnf).slice(0, 3).map((r) => r.name).join(', ') || 'none'}`);
  }

  function toLobby() {
    room.phase = 'lobby';
    room.countdownEndsAt = null;
    room.startAt = null;
    room.results = null;
    room.grid = [];
    room.finishedRows.clear();
    // Lingering seats only make sense inside the race they dropped from.
    for (const p of [...players.values()]) if (p.lingerUntil) players.delete(p.id);
    for (const p of players.values()) {
      p.spectator = false; // everyone waiting gets a grid slot next round
      p.ready = p.bot ? true : false;
      p.finished = false;
      p.place = null;
      p.timeMs = null;
      p.prog = 0;
      p.lap = 0;
      p._progAt = null;
      p._progStrikes = 0;
    }
    broadcast(phaseMsg());
    broadcast({ t: 'roster', players: roster() });
  }

  const lifecycleTimer = setInterval(() => {
    const t = now();
    // Reap lingering seats whose pilots never came back.
    for (const p of [...players.values()]) {
      if (p.lingerUntil && t > p.lingerUntil) {
        players.delete(p.id);
        broadcast({ t: 'leave', id: p.id });
        log(`[race] - ${p.name} (#${p.id}) linger expired — ${players.size} online`);
      }
    }
    ensureBots();
    const grid = gridPilots();

    // A room with zero humans doesn't race — drain bots and reset.
    if (humans().length === 0) {
      const leftoverBots = [...players.values()].filter((p) => p.bot);
      if (leftoverBots.length || room.phase !== 'lobby') {
        for (const b of leftoverBots) players.delete(b.id);
        if (room.phase !== 'lobby') {
          room.phase = 'lobby';
          room.countdownEndsAt = null;
          room.startAt = null;
          room.results = null;
          room.grid = [];
        }
      }
      return;
    }

    if (room.phase === 'lobby' && grid.length >= MIN_PILOTS) armGrid();

    if (room.phase === 'armed') {
      if (grid.length < MIN_PILOTS) return disarmGrid();
      const humanGrid = grid.filter((p) => !p.bot);
      const allReady = humanGrid.length > 0 && humanGrid.every((p) => p.ready);
      if (allReady && room.countdownEndsAt - t > ALL_READY_MS) {
        room.countdownEndsAt = t + ALL_READY_MS;
        broadcast(phaseMsg());
      }
      if (t >= room.countdownEndsAt) startRace();
    }

    if (room.phase === 'racing') {
      const racers = room.grid.map((id) => players.get(id)).filter(Boolean);
      const humanRacers = racers.filter((p) => !p.bot);
      const allDone = racers.length > 0 && racers.every((p) => p.finished);
      const windowOver = room.firstFinishAt && t - room.firstFinishAt > FINISH_WINDOW_MS;
      const capOver = room.startAt && t - room.startAt > RACE_CAP_MS;
      if (humanRacers.length === 0 && humans().length > 0) return toLobby(); // all human racers left; spectators remain
      if (allDone || windowOver || capOver) endRace();
    }

    if (room.phase === 'results' && t >= room.countdownEndsAt) toLobby();
  }, 250);

  /* --------------------------------------------------------- data relays */

  let lastSnapAt = now();
  const snapshotTimer = setInterval(() => {
    const t = now();
    const dt = Math.min(0.5, (t - lastSnapAt) / 1000);
    lastSnapAt = t;
    stepBots(dt);
    if (players.size < 2) return;
    const ps = [];
    for (const p of players.values()) {
      if (!p.state) continue;
      const s = p.state;
      ps.push([p.id, s.x, s.y, s.z, s.h, s.k, s.s, s.b ? 1 : 0, p.prog, p.lap ?? 0]);
    }
    if (ps.length) broadcast({ t: 'snap', ps, now: t });
  }, SNAPSHOT_MS);

  const standingsTimer = setInterval(() => {
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

  /* ------------------------------------------------------------- seats */

  function connect(sendFn) {
    let me = null;
    let open = true;

    const receive = (m) => {
      if (!open || !m || typeof m.t !== 'string') return;

      // Lightweight status probe used by the hub's station panel.
      if (m.t === 'peek') {
        const botCount = [...players.values()].filter((p) => p.bot).length;
        try {
          sendFn({ t: 'peekInfo', pilots: players.size, humans: players.size - botCount, bots: botCount, phase: room.phase });
        } catch {}
        return;
      }

      if (m.t === 'hello') {
        if (me) return; // already registered on this seat — ignore repeat hellos
        const rk = typeof m.rk === 'string' && m.rk ? m.rk.slice(0, 32) : null;

        // Resume: a racer who dropped mid-race gets their seat back (same id,
        // same grid slot, same progress) if they return within the linger
        // window — a flaky wifi blip no longer costs the race.
        if (rk) {
          const lingering = [...players.values()].find((p) => p.lingerUntil && p.rk === rk);
          if (lingering) {
            me = lingering;
            me.send = sendFn;
            me.lingerUntil = null;
            send(me, {
              t: 'welcome',
              id: me.id,
              spectator: me.spectator,
              players: roster(),
              ...phaseFields(),
            });
            broadcast({ t: 'player', player: publicPlayer(me) }, me.id);
            log(`[race] ↻ ${me.name} (#${me.id}) resumed — ${players.size} online`);
            return;
          }
        }

        me = {
          id: nextId++,
          send: sendFn,
          rk,
          name: '',
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
          lingerUntil: null,
        };
        me.name = uniqueName(cleanName(m.name), me.id);
        players.set(me.id, me);
        // A pilot joining an armed grid deserves a beat to get set — re-float
        // an all-ready-shortened countdown back to a small floor.
        if (room.phase === 'armed' && room.countdownEndsAt - now() < ARMED_JOIN_FLOOR_MS) {
          room.countdownEndsAt = now() + ARMED_JOIN_FLOOR_MS;
          broadcast(phaseMsg());
        }
        send(me, {
          t: 'welcome',
          id: me.id,
          spectator: me.spectator,
          players: roster(),
          ...phaseFields(),
        });
        broadcast({ t: 'join', player: publicPlayer(me) }, me.id);
        log(`[race] + ${me.name} (#${me.id}) — ${players.size} online`);
        return;
      }

      if (!me) return; // everything below requires a hello first

      switch (m.t) {
        case 'profile': {
          if (m.name !== undefined) me.name = uniqueName(cleanName(m.name), me.id);
          if (m.hue !== undefined) me.hue = clampNum(m.hue, 0, 359) | 0;
          broadcast({ t: 'player', player: publicPlayer(me) });
          break;
        }
        case 'ready': {
          me.ready = !!m.on;
          broadcast({ t: 'player', player: publicPlayer(me) });
          break;
        }
        case 'vote': {
          // Circuit vote for the NEXT launch; only meaningful pre-race.
          if (room.phase !== 'lobby' && room.phase !== 'armed') break;
          me.voteTrack = Number.isInteger(m.track) && m.track >= 0 && m.track < TRACK_COUNT ? m.track : null;
          broadcast({ t: 'player', player: publicPlayer(me) });
          break;
        }
        case 'pickup': {
          // A racer flew through a pod. Client-detected like pads/gates; the
          // engine arbitrates only contention (first grab wins) + respawn.
          if (room.phase !== 'racing' || me.spectator || me.finished) break;
          const idx = m.idx | 0;
          if (idx < 0 || idx >= room.pickupKinds.length) break;
          if (now() < room.pickupTakenUntil[idx]) break; // already taken
          room.pickupTakenUntil[idx] = now() + PICKUP_RESPAWN_MS;
          const kind = room.pickupKinds[idx];
          broadcast({ t: 'pickupTaken', idx, id: me.id, kind, until: room.pickupTakenUntil[idx], now: now() });
          if (kind === 'emp' && me.state) {
            // EMP detonates at the grabber's ship; every client applies the
            // shock to itself if it's inside the blast and unshielded.
            broadcast({ t: 'emp', id: me.id, x: me.state.x, y: me.state.y, z: me.state.z });
          }
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
            const t = now();
            const claimed = clampNum(m.prog, 0, GATE_COUNT * LAPS + 1);
            // Progress-rate ceiling: a legit ship at absolute top speed covers
            // < 1 gate/s, so allow 1.6 with a burst allowance. Faster growth is
            // a doctored client — clamp it instead of relaying it, so cheated
            // prog can't climb the standings or unlock the finish guard.
            // (Position is NOT rate-checked: respawns teleport legitimately.)
            if (me._progAt) {
              const dt = Math.max(0.01, (t - me._progAt) / 1000);
              const ceiling = me.prog + 1.6 * dt + 0.5;
              if (claimed > ceiling) {
                me.prog = ceiling;
                me._progStrikes = (me._progStrikes || 0) + 1;
                if (me._progStrikes === 10) log(`[race] ! ${me.name} (#${me.id}) repeatedly over the progress ceiling — clamping`);
              } else {
                me.prog = claimed;
              }
            } else {
              me.prog = Math.min(claimed, 1.5); // first sample of the race starts near the line
            }
            me._progAt = t;
            me.lap = clampNum(m.lap, 0, 50) | 0;
          } else {
            me._progAt = null;
          }
          break;
        }
        case 'finish': {
          if (room.phase !== 'racing' || me.spectator || me.finished) break;
          if (now() < room.startAt) break; // nobody finishes before GO
          // Plausibility: a finish claim must be backed by near-complete track
          // progress from the state uplink. Honest clients report ~36 gates at
          // the line; this shuts down a bare {t:'finish'} fired from a console.
          if (me.prog < GATE_COUNT * LAPS - 2) break;
          me.finished = true;
          me.place = room.finishOrder.push(me.id);
          me.timeMs = now() - room.startAt;
          if (!room.firstFinishAt) room.firstFinishAt = now();
          room.finishedRows.set(me.id, { id: me.id, name: me.name, hue: me.hue, bot: false, place: me.place, timeMs: me.timeMs, dnf: false, prog: me.prog });
          broadcast({ t: 'finished', id: me.id, name: me.name, place: me.place, timeMs: me.timeMs });
          log(`[race] ${me.name} finished P${me.place} in ${(me.timeMs / 1000).toFixed(1)}s`);
          break;
        }
        default:
          break;
      }
    };

    const close = () => {
      if (!open) return;
      open = false;
      if (!me) return;
      // A racer dropping mid-race lingers instead of vanishing: their seat,
      // progress and grid slot survive LINGER_MS so a reconnect (same resume
      // key) puts them right back in the fight. Everyone else leaves cleanly.
      const midRace = room.phase === 'racing' && !me.spectator && !me.finished;
      if (midRace && me.rk) {
        me.send = null;
        me.state = null; // ship vanishes for the others until they're back
        me.lingerUntil = Date.now() + LINGER_MS;
        log(`[race] ~ ${me.name} (#${me.id}) link lost — holding seat ${LINGER_MS / 1000}s`);
      } else {
        players.delete(me.id);
        broadcast({ t: 'leave', id: me.id });
        log(`[race] - ${me.name} (#${me.id}) — ${players.size} online`);
      }
      me = null;
    };

    return { receive, close, get id() { return me?.id ?? null; } };
  }

  function dispose() {
    clearInterval(lifecycleTimer);
    clearInterval(snapshotTimer);
    clearInterval(standingsTimer);
    players.clear();
  }

  return { connect, dispose, humanCount: () => humans().length };
}
