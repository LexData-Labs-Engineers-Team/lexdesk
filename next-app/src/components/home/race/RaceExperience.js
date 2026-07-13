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
import { RaceNet } from './raceNet';
import { RaceLobby, Countdown, RaceStrip, StandingsRail, TelemetryBars, TrackMap, Podium, FinishBanner, LapTimer, FinalLapFlash } from './RaceHUD';
import Joystick from '../hub/Joystick';
import { audio } from '../hub/audio';

const SEND_MS = 85; // ~12 Hz state uplink, matches the server's snapshot tick

function loadIdentity() {
  let name = null;
  let hue = null;
  try {
    name = localStorage.getItem('teamos_callsign');
    const h = localStorage.getItem('teamos_pilot_hue');
    if (h !== null) hue = parseInt(h, 10);
    if (!name) {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      if (u?.name) name = String(u.name).trim().split(/\s+/)[0].slice(0, 14);
    }
  } catch {}
  if (!name) name = `PILOT-${100 + Math.floor(Math.random() * 900)}`;
  if (hue === null || Number.isNaN(hue)) hue = [0, 32, 58, 132, 174, 204, 262, 318][Math.floor(Math.random() * 8)];
  return { name, hue };
}

export default function RaceExperience({ onExit, lowPerf = false, touch = false }) {
  const netRef = useRef(null);
  if (!netRef.current) netRef.current = new RaceNet();

  const identity = useMemo(loadIdentity, []);
  const [callsign, setCallsign] = useState(identity.name);
  const [hue, setHue] = useState(identity.hue);

  const [conn, setConn] = useState('connecting'); // connecting | open | lost
  const [selfId, setSelfId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState('lobby');
  const [countdownEndsAt, setCountdownEndsAt] = useState(null);
  const [startAt, setStartAt] = useState(null);
  const [seed, setSeed] = useState(1);
  const [grid, setGrid] = useState([]);
  const [results, setResults] = useState(null);
  const [standings, setStandings] = useState([]);
  const [myPlace, setMyPlace] = useState(null);
  const [fleetVersion, setFleetVersion] = useState(0);
  const [warpIn, setWarpIn] = useState(true);
  const [muted, setMuted] = useState(audio.isMuted());

  const playersRef = useRef(new Map()); // remote id -> interpolation record
  const shipStateRef = useRef(null);    // latest local ship state (scene → net)
  const telemetryRef = useRef({
    speed01: 0, energy: 1, boost: false, slip: false, off: false, wrong: false,
    lap: 1, gate: 1, passed: 0, finished: false,
    lapStartPerf: 0, lastLapMs: 0, bestLapMs: 0,
  });
  const everOpenRef = useRef(false);

  const me = players.find((p) => p.id === selfId);
  const spectating = !!me?.spectator;
  const gridIndex = grid.indexOf(selfId);

  /* -------------------------------------------------- roster ↔ rec syncing */
  const syncRecs = useCallback((list, self) => {
    const map = playersRef.current;
    const ids = new Set();
    for (const p of list) {
      if (p.id === self) continue;
      ids.add(p.id);
      const rec = map.get(p.id);
      if (rec) {
        rec.name = p.name;
        rec.hue = p.hue;
      } else {
        map.set(p.id, { id: p.id, name: p.name, hue: p.hue, buf: [], cur: new THREE.Vector3(0, -999, 0), speed: 0, heading: 0 });
      }
    }
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
    setFleetVersion((v) => v + 1);
  }, []);

  /* ------------------------------------------------------------ networking */
  useEffect(() => {
    const net = netRef.current;
    const offs = [
      net.on('status', (s) => {
        if (s === 'open') {
          everOpenRef.current = true;
          setConn('open');
          net.send({ t: 'hello', name: callsign, hue });
        } else if (s === 'closed') {
          setConn('lost');
        }
      }),
      net.on('welcome', (m) => {
        setSelfId(m.id);
        setPlayers(m.players);
        setPhase(m.phase);
        setCountdownEndsAt(m.countdownEndsAt);
        setStartAt(m.startAt);
        setSeed(m.seed);
        setGrid(m.grid || []);
        setResults(m.results);
        syncRecs(m.players, m.id);
      }),
      net.on('join', (m) => {
        setPlayers((ps) => {
          const next = [...ps.filter((p) => p.id !== m.player.id), m.player];
          setSelfId((self) => { syncRecs(next, self); return self; });
          return next;
        });
        audio.blip();
      }),
      net.on('leave', (m) => {
        setPlayers((ps) => {
          const next = ps.filter((p) => p.id !== m.id);
          setSelfId((self) => { syncRecs(next, self); return self; });
          return next;
        });
      }),
      net.on('player', (m) => {
        setPlayers((ps) => {
          const next = ps.map((p) => (p.id === m.player.id ? m.player : p));
          setSelfId((self) => { syncRecs(next, self); return self; });
          return next;
        });
      }),
      net.on('roster', (m) => {
        setPlayers(m.players);
        setSelfId((self) => { syncRecs(m.players, self); return self; });
      }),
      net.on('phase', (m) => {
        setPhase(m.phase);
        setCountdownEndsAt(m.countdownEndsAt);
        setStartAt(m.startAt);
        setSeed(m.seed);
        setGrid(m.grid || []);
        setResults(m.results);
        if (m.phase === 'racing') {
          setMyPlace(null);
          setStandings([]);
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
      net.on('standings', (m) => setStandings(m.rows)),
      net.on('finished', (m) => {
        setSelfId((self) => {
          if (m.id === self) setMyPlace(m.place);
          return self;
        });
      }),
    ];
    net.connect();
    return () => {
      offs.forEach((off) => off());
      net.close();
    };
    // connect once per mount; callsign/hue updates flow via 'profile' messages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------- state uplink */
  useEffect(() => {
    if (conn !== 'open' || spectating) return undefined;
    const t = setInterval(() => {
      const s = shipStateRef.current;
      if (s) netRef.current.send({ t: 'state', ...s });
    }, SEND_MS);
    return () => clearInterval(t);
  }, [conn, spectating]);

  /* ---------------------------------------------------------- audio bed */
  useEffect(() => {
    audio.init();
    audio.startAmbient();
    audio.engineStart();
    return () => {
      audio.stopAmbient();
      audio.engineStop();
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setWarpIn(false), 750);
    return () => clearTimeout(t);
  }, []);

  /* ------------------------------------------------------------ actions */
  const handleProfile = useCallback((patch) => {
    if (patch.name) {
      setCallsign(patch.name);
      try { localStorage.setItem('teamos_callsign', patch.name); } catch {}
    }
    if (patch.hue !== undefined) {
      setHue(patch.hue);
      try { localStorage.setItem('teamos_pilot_hue', String(patch.hue)); } catch {}
    }
    netRef.current.send({ t: 'profile', ...patch });
  }, []);

  const handleReady = useCallback((on) => {
    audio.blip();
    netRef.current.send({ t: 'ready', on });
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

  const control = useRef({ thrust: 0, turn: 0, boost: false });
  const inLobby = phase === 'lobby' || phase === 'armed';
  const racing = phase === 'racing';

  return (
    <div className="hub-root race-root">
      <Canvas
        className="hub-canvas"
        dpr={lowPerf ? [1, 1.25] : [1, 1.5]}
        gl={{ antialias: !lowPerf, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 8, -30], fov: 55 }}
      >
        <Suspense fallback={null}>
          <RaceScene
            phase={phase}
            startAt={startAt}
            seed={seed}
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
        </button>
        <div className="hub-topbar__right">
          <button type="button" className="hub-icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
            )}
          </button>
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
            ) : (
              <>
                <h2 className="race-conn__title">{everOpenRef.current ? 'Link lost' : 'Arena offline'}</h2>
                <p className="race-conn__sub">
                  {everOpenRef.current
                    ? 'The connection to the race server dropped.'
                    : 'The race server isn’t reachable. Start it with npm run race:server, then retry.'}
                </p>
                <div className="race-conn__actions">
                  <button type="button" className="btn-primary px-6 py-2.5 text-[0.9rem]" onClick={retry}>Retry</button>
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
          <TrackMap playersRef={playersRef} shipStateRef={shipStateRef} selfId={selfId} selfHue={hue} />
          <LapTimer telemetryRef={telemetryRef} />
          <FinalLapFlash telemetryRef={telemetryRef} />
          {myPlace && !results && <FinishBanner place={myPlace} />}
        </>
      )}
      {conn === 'open' && racing && spectating && (
        <>
          <StandingsRail standings={standings} players={players} selfId={selfId} />
          <TrackMap playersRef={playersRef} shipStateRef={shipStateRef} selfId={selfId} selfHue={hue} />
        </>
      )}

      {/* podium */}
      {conn === 'open' && phase === 'results' && <Podium results={results} selfId={selfId} onExit={onExit} />}

      {/* touch controls */}
      {touch && conn === 'open' && !spectating && <Joystick controlRef={control} />}
    </div>
  );
}
