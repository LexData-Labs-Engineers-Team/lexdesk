'use client';

// Orchestrates the Nebula Grand Prix: owns the WebSocket (RaceNet), the shared
// roster, race phase and standings state, and the per-frame refs that link the
// 3D scene to the DOM HUD. Remote ship positions never touch React state —
// snapshots land in a ref map the scene interpolates from; React only re-renders
// on membership / phase / standings changes (all low-frequency).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import RaceScene from './RaceScene';
import { RaceNet, getRaceRoom } from './raceNet';
import { createLocalNet } from './localArena';
import { useGamepad } from './useGamepad';
import { dealPickupKinds, TRACKS } from './trackData.mjs';
import { apiFetch } from '../../../lib/apiFetch';
import { RaceLobby, Countdown, RaceStrip, StandingsRail, TelemetryBars, TrackMap, Podium, FinishBanner, LapTimer, FinalLapFlash } from './RaceHUD';
import Joystick from '../hub/Joystick';
import { audio } from '../hub/audio';

const SEND_MS = 85; // ~12 Hz state uplink, matches the server's snapshot tick

function loadIdentity() {
  let name = null;
  let hue = null;
  let rk = null;
  try {
    name = localStorage.getItem('teamos_callsign');
    const h = localStorage.getItem('teamos_pilot_hue');
    if (h !== null) hue = parseInt(h, 10);
    if (!name) {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      if (u?.name) name = String(u.name).trim().split(/\s+/)[0].slice(0, 14);
    }
    // Per-tab resume key: lets the server give us our seat back after a
    // mid-race disconnect instead of demoting us to spectator.
    rk = sessionStorage.getItem('teamos_race_rk');
    if (!rk) {
      rk = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('teamos_race_rk', rk);
    }
  } catch {}
  if (!name) name = `PILOT-${100 + Math.floor(Math.random() * 900)}`;
  if (hue === null || Number.isNaN(hue)) hue = [0, 32, 58, 132, 174, 204, 262, 318][Math.floor(Math.random() * 8)];
  return { name, hue, rk };
}

export default function RaceExperience({ onExit, lowPerf = false, touch = false }) {
  // 'online' rides a RaceNet websocket to the shared arena; 'practice' runs the
  // same engine in-page against AI pilots (no server needed). The ref object is
  // stable across the swap so scene/HUD children never re-bind.
  const [mode, setMode] = useState('online');
  const netRef = useRef(null);
  if (!netRef.current) netRef.current = new RaceNet();

  const identity = useMemo(loadIdentity, []);
  const [callsign, setCallsign] = useState(identity.name);
  const [hue, setHue] = useState(identity.hue);
  // Live mirror of the identity, so the (mount-once) reconnect handler always
  // re-sends the CURRENT callsign/hue instead of stale mount-time values.
  const identityRef = useRef({ name: identity.name, hue: identity.hue });

  const [conn, setConn] = useState('connecting'); // connecting | open | lost
  const [selfId, setSelfId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState('lobby');
  const [countdownEndsAt, setCountdownEndsAt] = useState(null);
  const [startAt, setStartAt] = useState(null);
  const [seed, setSeed] = useState(1);
  const [trackId, setTrackId] = useState(0);
  const [grid, setGrid] = useState([]);
  const [results, setResults] = useState(null);
  const [standings, setStandings] = useState([]);
  const [myPlace, setMyPlace] = useState(null);
  const [photoGapMs, setPhotoGapMs] = useState(null);
  const [feed, setFeed] = useState([]); // overtake toasts
  const [autoTier, setAutoTier] = useState(0); // fps governor: 0 full → 2 minimal
  const [fleetVersion, setFleetVersion] = useState(0);
  const [warpIn, setWarpIn] = useState(true);
  const [muted, setMuted] = useState(audio.isMuted());
  const [ghost, setGhost] = useState(null);

  const playersRef = useRef(new Map()); // remote id -> interpolation record
  // Event-time mirrors of selfId/players: message handlers read + write these
  // directly so roster math never happens inside a setState updater (updaters
  // must be pure — StrictMode double-runs them, which double-fired syncRecs).
  const selfIdRef = useRef(null);
  const playersListRef = useRef([]);
  const shipStateRef = useRef(null);    // latest local ship state (scene → net)
  // Pickup pod truth: per-pod respawn timestamps (server clock) + dealt kinds.
  const pickupsRef = useRef({ takenUntil: [], kinds: [] });
  // Power events for the scene (grants + EMP shocks), drained per frame.
  const powerRef = useRef({ queue: [] });
  // Ghost lap recorder — frames of [x,y,z,h] at the uplink cadence, from GO.
  const ghostRecRef = useRef({ startAt: null, frames: [], done: false });
  const finishTimesRef = useRef(new Map()); // place -> timeMs (photo-finish gaps)
  const prevOrderRef = useRef([]);          // last standings order (overtake feed)
  const postedRef = useRef(null);           // startAt of the race we last reported
  const telemetryRef = useRef({
    speed01: 0, energy: 1, boost: false, slip: false, off: false, wrong: false,
    lap: 1, gate: 1, passed: 0, finished: false,
    lapStartPerf: 0, lastLapMs: 0, bestLapMs: 0,
  });
  const everOpenRef = useRef(false);

  const me = players.find((p) => p.id === selfId);
  const spectating = !!me?.spectator;
  const gridIndex = grid.indexOf(selfId);

  // Short-lived race toasts (overtakes, pickups) — capped at three on screen.
  const feedKeyRef = useRef(0);
  const pushFeed = useCallback((text, tone) => {
    const key = ++feedKeyRef.current;
    setFeed((f) => [...f.slice(-2), { key, text, tone }]);
    setTimeout(() => setFeed((f) => f.filter((e) => e.key !== key)), 4000);
  }, []);

  // Persist the run as this circuit's ghost if it beats the stored best.
  const saveGhostIfBest = useCallback((timeMs) => {
    const rec = ghostRecRef.current;
    if (!rec.frames.length || rec.done) return;
    rec.done = true;
    try {
      const key = `teamos_ghost_t${rec.trackId ?? 0}`;
      const prior = JSON.parse(localStorage.getItem(key) || 'null');
      if (!prior || timeMs < prior.timeMs) {
        localStorage.setItem(key, JSON.stringify({ v: 1, timeMs, dt: SEND_MS, frames: rec.frames }));
      }
    } catch {}
  }, []);

  /* -------------------------------------------------- roster ↔ rec syncing */
  const syncRecs = useCallback((list, self) => {
    const map = playersRef.current;
    const ids = new Set();
    for (const p of list) {
      // Skip self and spectators: spectators never uplink state, so a rec for
      // them would sit forever at the sentinel and render as a ghost ship /
      // phantom minimap dot. They reappear as real ships once they're racing.
      if (p.id === self || p.spectator) continue;
      ids.add(p.id);
      const rec = map.get(p.id);
      if (rec) {
        rec.name = p.name;
        rec.hue = p.hue;
      } else {
        map.set(p.id, { id: p.id, name: p.name, hue: p.hue, buf: [], cur: new THREE.Vector3(0, -999, 0), speed: 0, heading: 0, placed: false });
      }
    }
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
    setFleetVersion((v) => v + 1);
  }, []);

  /* ------------------------------------------------------------ networking */
  useEffect(() => {
    // Swap transports when the mode flips; re-wire handlers either way.
    const wantLocal = mode === 'practice';
    if (!!netRef.current?.isLocal !== wantLocal) {
      netRef.current?.close();
      netRef.current = wantLocal ? createLocalNet() : new RaceNet();
    }
    const net = netRef.current;
    // A fresh transport means a fresh room: drop everything learned from the
    // previous one so ghosts of the other arena never leak across.
    setConn('connecting');
    setSelfId(null);
    setPlayers([]);
    setPhase('lobby');
    setCountdownEndsAt(null);
    setStartAt(null);
    setGrid([]);
    setResults(null);
    setStandings([]);
    setMyPlace(null);
    setPhotoGapMs(null);
    setFeed([]);
    playersRef.current.clear();
    selfIdRef.current = null;
    playersListRef.current = [];
    pickupsRef.current = { takenUntil: [], kinds: [] };
    powerRef.current = { queue: [] };
    ghostRecRef.current = { startAt: null, frames: [], done: false };
    finishTimesRef.current = new Map();
    prevOrderRef.current = [];
    setFleetVersion((v) => v + 1);
    everOpenRef.current = false;
    // Single entry point for roster changes: update the event-time mirror,
    // hand React the same list, and sync interpolation records — all outside
    // any state updater, so it stays pure under StrictMode.
    const applyRoster = (list) => {
      playersListRef.current = list;
      setPlayers(list);
      syncRecs(list, selfIdRef.current);
    };
    // The server may have adjusted our callsign (dedup vs a teammate with the
    // same name) — mirror what it actually calls us, without persisting.
    const reconcileName = (row) => {
      if (row && row.name && row.name !== identityRef.current.name) {
        identityRef.current.name = row.name;
        setCallsign(row.name);
      }
    };
    const offs = [
      net.on('status', (s) => {
        if (s === 'open') {
          everOpenRef.current = true;
          setConn('open');
          net.send({ t: 'hello', name: identityRef.current.name, hue: identityRef.current.hue, rk: identity.rk });
        } else if (s === 'closed') {
          setConn('lost');
        } else if (s === 'reconnecting') {
          setConn('reconnecting');
        }
      }),
      net.on('welcome', (m) => {
        selfIdRef.current = m.id;
        setSelfId(m.id);
        setPhase(m.phase);
        setCountdownEndsAt(m.countdownEndsAt);
        setStartAt(m.startAt);
        setSeed(m.seed);
        setTrackId(m.trackId ?? 0);
        setGrid(m.grid || []);
        setResults(m.results);
        pickupsRef.current.takenUntil = [...(m.pickups || [])];
        pickupsRef.current.kinds = m.phase === 'racing' ? dealPickupKinds(m.seed, m.trackId ?? 0) : [];
        applyRoster(m.players);
        reconcileName(m.players.find((p) => p.id === m.id));
      }),
      net.on('join', (m) => {
        applyRoster([...playersListRef.current.filter((p) => p.id !== m.player.id), m.player]);
        audio.blip();
      }),
      net.on('leave', (m) => {
        applyRoster(playersListRef.current.filter((p) => p.id !== m.id));
      }),
      net.on('player', (m) => {
        applyRoster(playersListRef.current.map((p) => (p.id === m.player.id ? m.player : p)));
        if (m.player.id === selfIdRef.current) reconcileName(m.player);
      }),
      net.on('roster', (m) => {
        applyRoster(m.players);
      }),
      net.on('phase', (m) => {
        setPhase(m.phase);
        setCountdownEndsAt(m.countdownEndsAt);
        setStartAt(m.startAt);
        setSeed(m.seed);
        setTrackId(m.trackId ?? 0);
        setGrid(m.grid || []);
        setResults(m.results);
        pickupsRef.current.takenUntil = [...(m.pickups || [])];
        if (m.phase === 'racing') {
          setMyPlace(null);
          setPhotoGapMs(null);
          setStandings([]);
          setFeed([]);
          pickupsRef.current.kinds = dealPickupKinds(m.seed, m.trackId ?? 0);
          ghostRecRef.current = { startAt: m.startAt, frames: [], done: false, trackId: m.trackId ?? 0 };
          finishTimesRef.current = new Map();
          prevOrderRef.current = [];
          // Load the personal-best ghost for this circuit (practice only —
          // online grids race real rivals, not echoes).
          try {
            const raw = localStorage.getItem(`teamos_ghost_t${m.trackId ?? 0}`);
            setGhost(raw ? JSON.parse(raw) : null);
          } catch { setGhost(null); }
        }
        if (m.phase === 'results') audio.fanfare();
      }),
      net.on('snap', (m) => {
        const map = playersRef.current;
        for (const row of m.ps) {
          const [id, x, y, z, h, k, s, b] = row;
          const rec = map.get(id);
          if (!rec) continue;
          rec.buf.push({ t: m.now, x, y, z, h, k, s, b: !!b });
          if (rec.buf.length > 4) rec.buf.shift();
        }
      }),
      net.on('standings', (m) => {
        setStandings(m.rows);
        // Overtake feed: compare my ladder position against the last tick.
        const self = selfIdRef.current;
        const order = m.rows.map((r) => r.id);
        const prev = prevOrderRef.current;
        prevOrderRef.current = order;
        if (!self || !prev.length || !order.includes(self)) return;
        const was = prev.indexOf(self);
        const is = order.indexOf(self);
        if (was === -1 || is === was) return;
        const byId = Object.fromEntries(playersListRef.current.map((p) => [p.id, p]));
        if (is < was) {
          // moved up — name the highest-profile ship we cleared
          const cleared = prev.filter((id, i) => i < was && order.indexOf(id) > is).map((id) => byId[id]?.name).filter(Boolean);
          if (cleared.length) {
            audio.overtake?.();
            pushFeed(`Passed ${cleared[0]}${cleared.length > 1 ? ` +${cleared.length - 1}` : ''}`, 'up');
          }
        } else {
          const taker = order.filter((id, i) => i < is && prev.indexOf(id) > was).map((id) => byId[id]?.name).filter(Boolean);
          if (taker.length) {
            audio.overtaken?.();
            pushFeed(`${taker[0]} got by you`, 'down');
          }
        }
      }),
      net.on('pickupTaken', (m) => {
        pickupsRef.current.takenUntil[m.idx] = m.until;
        if (m.id === selfIdRef.current) {
          powerRef.current.queue.push({ type: 'grant', kind: m.kind });
          pushFeed(m.kind === 'shield' ? 'SHIELD armed' : m.kind === 'overcharge' ? 'OVERCHARGE' : 'EMP away', 'up');
        }
      }),
      net.on('emp', (m) => {
        if (m.id !== selfIdRef.current) powerRef.current.queue.push({ type: 'emp', x: m.x, z: m.z });
      }),
      net.on('finished', (m) => {
        finishTimesRef.current.set(m.place, m.timeMs);
        if (m.id === selfIdRef.current) {
          setMyPlace(m.place);
          // Photo finish: how close was the ship right ahead?
          const ahead = finishTimesRef.current.get(m.place - 1);
          if (ahead !== undefined && m.timeMs - ahead < 1000) setPhotoGapMs(m.timeMs - ahead);
          saveGhostIfBest(m.timeMs);
        }
      }),
    ];
    net.connect();
    return () => {
      offs.forEach((off) => off());
      net.close();
    };
    // reconnects once per mode; callsign/hue updates flow via 'profile' messages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* ------------------------------------------------------- state uplink */
  useEffect(() => {
    if (conn !== 'open' || spectating) return undefined;
    const t = setInterval(() => {
      const s = shipStateRef.current;
      if (!s) return;
      netRef.current.send({ t: 'state', ...s });
      // Ghost recorder piggybacks the uplink cadence: frames from GO until the
      // flag, quantized — a full 3-lap run stays well under 100 KB.
      const rec = ghostRecRef.current;
      if (
        rec.startAt && !rec.done && rec.frames.length < 6000 &&
        !telemetryRef.current.finished &&
        (netRef.current.serverNow?.() ?? Date.now()) >= rec.startAt
      ) {
        rec.frames.push([
          Math.round(s.x * 100) / 100,
          Math.round(s.y * 100) / 100,
          Math.round(s.z * 100) / 100,
          Math.round(s.h * 1000) / 1000,
        ]);
      }
    }, SEND_MS);
    return () => clearInterval(t);
  }, [conn, spectating]);

  /* ----------------------------------------------- gamepad + season report */
  const control = useRef({ thrust: 0, turn: 0, boost: false });
  useGamepad(control);

  // Report finished online races to the office leaderboard (fire-and-forget).
  useEffect(() => {
    if (phase !== 'results' || mode !== 'online' || !results || postedRef.current === startAt) return;
    const r = results.find((row) => row.id === selfId && !row.bot);
    if (!r || r.dnf || !r.place) return;
    postedRef.current = startAt;
    let token = null;
    try { token = localStorage.getItem('token'); } catch {}
    apiFetch('/api/race/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        trackId,
        place: r.place,
        timeMs: r.timeMs,
        bestLapMs: telemetryRef.current.bestLapMs || null,
        humans: results.filter((row) => !row.bot).length,
        callsign: identityRef.current.name,
      }),
    }).catch(() => {});
  }, [phase, mode, results, selfId, startAt, trackId]);

  /* ---------------------------------------------------------- audio bed */
  // The ambient drone + engine are shared singletons owned by the hub. We make
  // sure they're running (no-ops if the hub already started them) but must NOT
  // stop them on unmount — the hub is still mounted underneath and would be
  // left permanently silent after leaving the arena.
  useEffect(() => {
    audio.init();
    audio.startAmbient();
    audio.engineStart();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setWarpIn(false), 750);
    return () => clearTimeout(t);
  }, []);

  /* ------------------------------------------------------------ actions */
  const handleProfile = useCallback((patch) => {
    if (patch.name) {
      identityRef.current.name = patch.name;
      setCallsign(patch.name);
      try { localStorage.setItem('teamos_callsign', patch.name); } catch {}
    }
    if (patch.hue !== undefined) {
      identityRef.current.hue = patch.hue;
      setHue(patch.hue);
      try { localStorage.setItem('teamos_pilot_hue', String(patch.hue)); } catch {}
    }
    netRef.current.send({ t: 'profile', ...patch });
  }, []);

  const handleReady = useCallback((on) => {
    audio.blip();
    netRef.current.send({ t: 'ready', on });
  }, []);

  const handleVote = useCallback((track) => {
    audio.blip();
    netRef.current.send({ t: 'vote', track });
  }, []);

  const handleFinish = useCallback(() => {
    audio.fanfare();
    netRef.current.send({ t: 'finish' });
  }, []);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    audio.init();
    audio.setMuted(m);
  };

  const retry = () => {
    setConn('connecting');
    netRef.current.connect();
  };

  const inLobby = phase === 'lobby' || phase === 'armed';
  const racing = phase === 'racing';
  const room = getRaceRoom();

  return (
    <div className="hub-root race-root">
      <Canvas
        className="hub-canvas"
        dpr={autoTier >= 2 ? 1 : autoTier === 1 || lowPerf ? [1, 1.25] : [1, 1.5]}
        gl={{ antialias: !lowPerf, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 8, -30], fov: 55 }}
      >
        <Suspense fallback={null}>
          <RaceScene
            phase={phase}
            startAt={startAt}
            seed={seed}
            trackId={trackId}
            gridIndex={gridIndex}
            spectating={spectating && racing}
            lowPerf={lowPerf}
            control={control}
            playersRef={playersRef}
            fleetVersion={fleetVersion}
            shipStateRef={shipStateRef}
            telemetryRef={telemetryRef}
            netRef={netRef}
            selfHue={hue}
            pickupsRef={pickupsRef}
            powerRef={powerRef}
            ghost={mode === 'practice' ? ghost : null}
            autoTier={autoTier}
            onTier={setAutoTier}
            onFinish={handleFinish}
          />
        </Suspense>
      </Canvas>

      {warpIn && <div className="hub-warp" aria-hidden="true" />}

      <header className="hub-topbar">
        <button type="button" className="hub-brand" onClick={onExit}>
          <span className="hub-brand__mark">T</span>
          <span className="hub-brand__name">TeamOS</span>
          <span className="race-brand-tag">GRAND PRIX</span>
          {mode === 'practice' && <span className="race-brand-tag is-practice">PRACTICE · AI</span>}
          {room && mode === 'online' && <span className="race-brand-tag">ROOM · {room.toUpperCase()}</span>}
        </button>
        <div className="hub-topbar__right">
          <button type="button" className="hub-icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
            )}
          </button>
          {mode === 'practice' && (
            <button type="button" className="hub-ghost" onClick={() => setMode('online')} title="Try the live multiplayer arena">
              Go online
            </button>
          )}
          <button type="button" className="hub-ghost" onClick={onExit}>Leave arena</button>
        </div>
      </header>

      {/* connection states */}
      {conn !== 'open' && (
        <div className="race-conn">
          <div className="hub-panel glossy race-conn__panel">
            <span className="hub-panel__eyebrow">Race arena</span>
            {conn === 'connecting' ? (
              <>
                <h2 className="race-conn__title">Linking to the grid…</h2>
                <p className="race-conn__sub">Contacting the race server.</p>
              </>
            ) : conn === 'reconnecting' ? (
              <>
                <h2 className="race-conn__title">Link lost — rejoining…</h2>
                <p className="race-conn__sub">The race link dropped. Reconnecting automatically.</p>
                <div className="race-conn__actions">
                  <button type="button" className="hub-ghost" onClick={() => setMode('practice')}>Race the AI instead</button>
                  <button type="button" className="hub-ghost" onClick={onExit}>Back to hub</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="race-conn__title">{everOpenRef.current ? 'Link lost' : 'Arena offline'}</h2>
                <p className="race-conn__sub">
                  {everOpenRef.current
                    ? 'The connection to the race server dropped and retries ran out.'
                    : 'No race server is reachable from here — but the AI grid is always open.'}
                </p>
                <div className="race-conn__actions">
                  <button type="button" className="btn-primary px-6 py-2.5 text-[0.9rem]" onClick={() => setMode('practice')}>
                    Race the AI
                  </button>
                  <button type="button" className="hub-ghost" onClick={retry}>Retry online</button>
                  <button type="button" className="hub-ghost" onClick={onExit}>Back to hub</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* lobby + rules (also shown to spectators outside an active race) */}
      {conn === 'open' && (inLobby || (spectating && racing)) && !results && (
        <RaceLobby
          players={players}
          selfId={selfId}
          phase={phase}
          countdownEndsAt={countdownEndsAt}
          netRef={netRef}
          spectating={spectating && racing}
          callsign={callsign}
          hue={hue}
          trackId={trackId}
          onVote={handleVote}
          onProfile={handleProfile}
          onReady={handleReady}
          onExit={onExit}
          touch={touch}
        />
      )}

      {/* live race overlays */}
      {conn === 'open' && racing && !spectating && (
        <>
          <Countdown startAt={startAt} netRef={netRef} />
          <RaceStrip standings={standings} selfId={selfId} telemetryRef={telemetryRef} />
          <StandingsRail standings={standings} players={players} selfId={selfId} />
          <TelemetryBars telemetryRef={telemetryRef} />
          <TrackMap playersRef={playersRef} shipStateRef={shipStateRef} selfId={selfId} selfHue={hue} telemetryRef={telemetryRef} trackId={trackId} />
          <LapTimer telemetryRef={telemetryRef} />
          <FinalLapFlash telemetryRef={telemetryRef} />
          {feed.length > 0 && (
            <div className="race-feed" aria-hidden="true">
              {feed.map((e) => (
                <div key={e.key} className={`race-feed__item is-${e.tone}`}>{e.text}</div>
              ))}
            </div>
          )}
          {myPlace && !results && <FinishBanner place={myPlace} gapMs={photoGapMs} />}
        </>
      )}
      {conn === 'open' && racing && spectating && (
        <>
          <StandingsRail standings={standings} players={players} selfId={selfId} />
          <TrackMap playersRef={playersRef} shipStateRef={shipStateRef} selfId={selfId} selfHue={hue} trackId={trackId} />
        </>
      )}

      {/* podium */}
      {conn === 'open' && phase === 'results' && <Podium results={results} selfId={selfId} onExit={onExit} />}

      {/* touch controls */}
      {touch && conn === 'open' && !spectating && <Joystick controlRef={control} />}
    </div>
  );
}
