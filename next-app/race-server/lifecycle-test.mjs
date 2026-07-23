// Nebula Grand Prix lifecycle test — run from next-app/ so `ws` resolves:
//   npm run race:test  (or: node race-server/lifecycle-test.mjs [url])
// Two synthetic pilots join, ready up, "fly" (stream fake state), finish, and
// we assert the room walks lobby → armed → racing → results → lobby, that AI
// pilots fill the grid, and that snapshots relay bot + human ships.

import WebSocket from 'ws';

const URL = process.argv[2] || 'ws://localhost:3000/race-ws';
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let failures = 0;
const expect = (cond, what) => {
  if (cond) log('  ✓', what);
  else { failures += 1; log('  ✗ FAIL:', what); }
};

function pilot(name, hue, rk = null) {
  const p = {
    name, rk, ws: new WebSocket(URL),
    id: null, phase: null, startAt: null, seed: null, spectator: null,
    players: [], sawBotJoin: false, sawSnapBots: 0, sawSnapSelfPeer: 0,
    finishedMsg: null, resultsSeen: null, standingsRows: 0, prog: 0,
  };
  p.ws.on('open', () => {
    p.ws.send(JSON.stringify({ t: 'hello', name, hue, rk }));
  });
  p.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    switch (m.t) {
      case 'welcome':
        p.id = m.id; p.phase = m.phase; p.players = m.players; p.seed = m.seed;
        p.spectator = m.spectator;
        if (m.phase === 'racing') { p.startAt = m.startAt; p.grid = m.grid; }
        break;
      case 'join':
        p.players.push(m.player);
        if (m.player.bot) p.sawBotJoin = true;
        break;
      case 'leave':
        p.players = p.players.filter((x) => x.id !== m.id);
        break;
      case 'roster':
        p.players = m.players;
        break;
      case 'phase':
        p.phase = m.phase;
        if (m.phase === 'racing') { p.startAt = m.startAt; p.seed = m.seed; p.grid = m.grid; p.trackId = m.trackId; }
        if (m.phase === 'results') p.resultsSeen = m.results;
        break;
      case 'snap': {
        const ids = new Set(m.ps.map((r) => r[0]));
        const bots = p.players.filter((x) => x.bot).map((x) => x.id);
        if (bots.some((b) => ids.has(b))) p.sawSnapBots += 1;
        if ([...ids].some((id) => id !== p.id)) p.sawSnapSelfPeer += 1;
        break;
      }
      case 'standings':
        p.standingsRows = m.rows.length;
        break;
      case 'finished':
        if (m.id === p.id) p.finishedMsg = m;
        break;
    }
  });
  p.ws.on('error', (e) => log(`${name} ws error:`, e.message));
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(120);
  }
  log('  ✗ TIMEOUT waiting for:', what);
  failures += 1;
  return false;
};

log(`connecting two pilots to ${URL}`);
const A = pilot('TEST-ALPHA', 32, 'resume-key-alpha');
const B = pilot('TEST-BRAVO', 204);

await until(() => A.id && B.id, 'both welcomes');
expect(A.id !== B.id, `distinct ids (${A.id}, ${B.id})`);

await until(() => A.players.some((x) => x.bot), 'AI pilots joined the lobby', 8000);
expect(A.players.filter((x) => x.bot).length >= 2, `bots on the grid (${A.players.filter((x) => x.bot).length})`);

// A votes for circuit 1 (Ion Straits) — sole ballot must win the tally
A.ws.send(JSON.stringify({ t: 'vote', track: 1 }));

// both ready → countdown should shorten and launch within ~7s
A.ws.send(JSON.stringify({ t: 'ready', on: true }));
B.ws.send(JSON.stringify({ t: 'ready', on: true }));
await until(() => A.phase === 'armed' || A.phase === 'racing', 'grid armed');
await until(() => A.phase === 'racing' && B.phase === 'racing', 'race started (all-ready shortcut)', 25000);
expect(A.seed === B.seed, `same obstacle seed (${A.seed})`);
expect(A.trackId === 1 && B.trackId === 1, `circuit vote honored (track ${A.trackId})`);
expect(Array.isArray(A.grid) && A.grid.includes(A.id) && A.grid.includes(B.id), 'both humans on the grid');

// stream state so the relay has something to broadcast; wait for GO. Progress
// ramps toward the full 36 gates so finish claims pass the plausibility guard.
const t0 = Date.now();
const streamers = [A, B]; // mutated when A resumes on a new socket
const stream = setInterval(() => {
  // ~1.2 gates/s — must stay under the engine's anti-cheat progress ceiling
  // (1.6/s) or the relay clamps us and the finish guard rejects the run.
  const prog = Math.min(35.9, ((Date.now() - t0) / 1000) * 1.2); // ~30s to "complete"
  for (const p of streamers) {
    if (p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ t: 'state', x: 0, y: 2, z: -78, h: 0, k: 0, s: 20, b: false, prog, lap: Math.min(2, Math.floor(prog / 12)) }));
    }
  }
}, 85);

await until(() => A.sawSnapSelfPeer > 3, 'A receives peer snapshots');
await until(() => A.sawSnapBots > 3, 'A receives AI ship snapshots');
await until(() => A.standingsRows >= 4, `standings include the full grid (got ${A.standingsRows})`);
await until(() => Date.now() >= A.startAt + 500, 'GO moment');

// premature finish must be rejected (plausibility guard)
A.ws.send(JSON.stringify({ t: 'finish' }));
await sleep(700);
expect(!A.finishedMsg, 'early finish (low prog) rejected');

// mid-race disconnect + resume: A drops and returns with the same resume key
const oldAId = A.id;
A.ws.close();
await sleep(900);
const A2 = pilot('TEST-ALPHA', 32, 'resume-key-alpha');
await until(() => A2.id, 'A2 welcome (resumed seat)');
expect(A2.id === oldAId, `resume kept the id (${oldAId} → ${A2.id})`);
expect(A2.spectator === false, 'resumed racer is NOT a spectator');
streamers.splice(0, streamers.length, A2, B);

// meanwhile a stranger joining mid-race must spectate
const S = pilot('TEST-LURKER', 90);
await until(() => S.id, 'lurker welcome');
expect(S.spectator === true, 'mid-race joiner spectates');
S.ws.close();

// wait until the ramp crosses the plausibility threshold, then finish
await until(() => ((Date.now() - t0) / 1000) * 1.2 >= 34.8, 'prog ramp complete', 45000);
await sleep(500);
B.ws.send(JSON.stringify({ t: 'finish' }));
await until(() => B.finishedMsg, 'B finish acknowledged');
expect(B.finishedMsg?.place === 1, `B took P1 (got P${B.finishedMsg?.place})`);
A2.ws.send(JSON.stringify({ t: 'finish' }));
await until(() => A2.finishedMsg, 'resumed A finish acknowledged');
expect(A2.finishedMsg?.place === 2, `resumed A took P2 (got P${A2.finishedMsg?.place})`);

// bots keep racing; the race ends when everyone's done (or window expires)
await until(() => B.phase === 'results', 'results phase reached', 120000);
clearInterval(stream);
expect(Array.isArray(B.resultsSeen) && B.resultsSeen.length >= 4, `podium rows include AI (${B.resultsSeen?.length})`);
expect(B.resultsSeen?.[0]?.name === 'TEST-BRAVO', `B on top of the podium (${B.resultsSeen?.[0]?.name})`);
expect(B.resultsSeen?.[1]?.name === 'TEST-ALPHA', `resumed A holds P2 on the podium (${B.resultsSeen?.[1]?.name})`);

await until(() => B.phase === 'lobby', 'back to lobby', 30000);

// name dedup: a third pilot with A's exact callsign (A2 still holds it)
const C = pilot('TEST-ALPHA', 90);
await until(() => C.id, 'C welcome');
const cSelf = () => C.players.find((x) => x.id === C.id);
await until(() => cSelf(), 'C sees itself in roster');
expect(cSelf()?.name !== 'TEST-ALPHA', `duplicate callsign de-duped (${cSelf()?.name})`);

for (const p of [A2, B, C]) { try { p.ws.close(); } catch {} }
log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
