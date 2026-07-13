'use client';

// Orchestrates the playable hub: owns selected (docked) + focused (in range) +
// warping state, feeds pointer parallax + a shared control channel (keyboard or
// touch joystick) + reads live ship state via refs (no per-frame re-renders),
// drives the radar, sounds, and warp, and lays the HUD with always-available
// exits. Dynamically imported with ssr:false by HomeExperience.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Canvas } from '@react-three/fiber';
import HubScene from './HubScene';
import HubHud from './HubHud';
import Radar from './Radar';
import Compass from './Compass';
import Joystick from './Joystick';
import { audio } from './audio';
import { STATIONS_BY_ID } from './stations';

// The multiplayer race arena — loaded only when a pilot actually enters it.
const RaceExperience = dynamic(() => import('../race/RaceExperience'), {
  ssr: false,
  loading: () => (
    <div className="hub-boot">
      <span className="hub-boot__ring" />
      <span className="hub-boot__text">Entering the arena…</span>
    </div>
  ),
});

const COMBO_WINDOW = 3000; // ms to chain a coin and keep the multiplier alive

export default function HubExperience({ onExit, lowPerf = false }) {
  const [selected, setSelected] = useState(null);
  const [focused, setFocused] = useState(null);
  const [muted, setMuted] = useState(false);
  const [warping, setWarping] = useState(false);
  const [raceMode, setRaceMode] = useState(false);
  const [touch, setTouch] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [multiplier, setMultiplier] = useState(1);
  const [comboKey, setComboKey] = useState(0);
  const pointer = useRef({ x: 0, y: 0 });
  const control = useRef({ thrust: 0, turn: 0, boost: false }); // keyboard + joystick
  const shipRef = useRef({ x: 0, z: 0, heading: 0, speed: 0, boost: false });
  const compassRef = useRef({ angle: 0, name: '', dist: 0, hidden: true });
  const prevSelected = useRef(null);
  const recordToBeat = useRef(0);
  const flashedRef = useRef(false);
  const comboRef = useRef(0);
  const lastCollectRef = useRef(0);
  const comboTimerRef = useRef(null);

  useEffect(() => {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    setTouch(coarse || 'ontouchstart' in window);
  }, []);

  const onPointerMove = useCallback((e) => {
    pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, []);

  // Unlock audio + start the ambient drone on the first gesture (browser policy).
  useEffect(() => {
    const unlock = () => {
      audio.init();
      audio.startAmbient();
      audio.engineStart();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.stopAmbient();
      audio.engineStop();
    };
  }, []);

  // Collecting in quick succession builds a combo multiplier (x1 → x5).
  const handleCollect = useCallback((n) => {
    audio.collect();
    const now = performance.now();
    const chaining = now - lastCollectRef.current < COMBO_WINDOW;
    lastCollectRef.current = now;
    comboRef.current = chaining ? comboRef.current + n : n;
    const mult = Math.min(1 + Math.floor(comboRef.current / 4), 5);
    setMultiplier(mult);
    setComboKey((k) => k + 1);
    setScore((s) => s + n * mult);
    clearTimeout(comboTimerRef.current);
    comboTimerRef.current = setTimeout(() => {
      comboRef.current = 0;
      setMultiplier(1);
    }, COMBO_WINDOW);
  }, []);

  useEffect(() => () => clearTimeout(comboTimerRef.current), []);

  // Persistent orb high-score.
  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem('teamos_orb_best') || '0', 10);
      recordToBeat.current = v;
      if (v > 0) setBest(v);
    } catch {}
  }, []);
  useEffect(() => {
    if (score > best) {
      setBest(score);
      try { localStorage.setItem('teamos_orb_best', String(score)); } catch {}
    }
  }, [score, best]);

  // Fire a one-time "NEW BEST!" flash the first time you beat this session's record.
  useEffect(() => {
    if (!flashedRef.current && score >= 3 && score > recordToBeat.current) {
      flashedRef.current = true;
      setNewBest(true);
      audio.fanfare();
    }
  }, [score]);
  // Auto-dismiss the flash — keyed on the flash itself so later collects can't cancel it.
  useEffect(() => {
    if (!newBest) return undefined;
    const t = setTimeout(() => setNewBest(false), 1900);
    return () => clearTimeout(t);
  }, [newBest]);

  // Dock / undock chimes + a hyperspace warp on both arrival and departure.
  useEffect(() => {
    let t;
    if (selected && selected !== prevSelected.current) {
      audio.dock();
      setWarping(true);
      t = setTimeout(() => setWarping(false), 700);
    } else if (!selected && prevSelected.current) {
      audio.undock();
      setWarping(true);
      t = setTimeout(() => setWarping(false), 600);
    }
    prevSelected.current = selected;
    return () => { if (t) clearTimeout(t); };
  }, [selected]);

  // Soft blip when a node enters docking range.
  useEffect(() => {
    if (focused) audio.blip();
  }, [focused]);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    audio.init();
    audio.setMuted(m);
  };

  // Warp out of the hub and into the race arena (and back).
  const enterRace = useCallback(() => {
    audio.dock();
    setWarping(true);
    setTimeout(() => {
      setSelected(null);
      setWarping(false);
      setRaceMode(true);
    }, 420);
  }, []);
  const exitRace = useCallback(() => {
    setRaceMode(false);
    setWarping(true);
    setTimeout(() => setWarping(false), 700);
  }, []);

  const focusedStation = focused ? STATIONS_BY_ID[focused] : null;

  if (raceMode) {
    return <RaceExperience lowPerf={lowPerf} touch={touch} onExit={exitRace} />;
  }

  return (
    <div className="hub-root" onPointerMove={onPointerMove}>
      <Canvas
        className={`hub-canvas${warping ? ' hub-shake' : ''}`}
        dpr={lowPerf ? [1, 1.25] : [1, 1.5]}
        gl={{ antialias: !lowPerf, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 3.9, -18], fov: 50 }}
      >
        <Suspense fallback={null}>
          <HubScene
            selected={selected}
            focused={focused}
            warping={warping}
            lowPerf={lowPerf}
            onSelect={setSelected}
            onFocusChange={setFocused}
            onBoost={() => audio.boost()}
            onCollect={handleCollect}
            pointer={pointer}
            control={control}
            shipRef={shipRef}
            compassRef={compassRef}
          />
        </Suspense>
      </Canvas>

      {warping && <div className="hub-warp" aria-hidden="true" />}

      {(score > 0 || best > 0) && (
        <div className="hub-score" aria-hidden="true">
          <span className="hub-score__icon">✦</span>
          {score}
          {best > 0 && <span className="hub-score__best">best {best}</span>}
        </div>
      )}

      {newBest && <div className="hub-newbest" aria-hidden="true">NEW BEST!</div>}

      {multiplier > 1 && (
        <div className="hub-combo" key={comboKey} aria-hidden="true" style={{ '--combo-ms': `${COMBO_WINDOW}ms` }}>
          <span className="hub-combo__mult">x{multiplier}</span>
          <span className="hub-combo__bar" />
        </div>
      )}

      <header className="hub-topbar">
        <button type="button" className="hub-brand" onClick={() => setSelected(null)}>
          <span className="hub-brand__mark">T</span>
          <span className="hub-brand__name">TeamOS</span>
        </button>
        <div className="hub-topbar__right">
          <button type="button" className="hub-icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
            )}
          </button>
          <button type="button" className="hub-ghost" onClick={onExit}>Classic view</button>
          <Link href="/register" className="btn-primary px-5 py-2 text-[0.85rem] no-underline">Sign in</Link>
        </div>
      </header>

      {/* Intro headline — fades away after a few seconds, leaving a clean stage. */}
      <div className="hub-intro">
        <h1 className="hub-intro__title">Where Teams Work Better Together.</h1>
        <p className="hub-intro__sub">
          {touch ? 'Pilot with the joystick — fly to a node and tap Dock.' : 'Pilot your ship — fly up to a node and dock to begin.'}
        </p>
      </div>

      {!selected && <Compass compassRef={compassRef} />}
      {!selected && !touch && <Radar shipRef={shipRef} focused={focused} />}

      {/* Desktop controls legend. */}
      {!selected && !touch && (
        <div className="hub-controls" aria-hidden="true">
          <span><kbd>↑</kbd> Thrust</span>
          <span><kbd>↓</kbd> Brake</span>
          <span><kbd>←</kbd><kbd>→</kbd> Steer</span>
          <span><kbd>Shift</kbd> Boost</span>
          <span><kbd>Enter</kbd> Dock</span>
        </div>
      )}

      {/* Touch controls. */}
      {!selected && touch && <Joystick controlRef={control} />}
      {!selected && touch && (
        <button
          type="button"
          className="hub-dock-btn"
          data-on={Boolean(focused)}
          onClick={() => { if (focused) setSelected(focused); }}
        >
          DOCK
        </button>
      )}

      {/* Docking prompt when a node is in range (desktop wording). */}
      {!selected && !touch && focusedStation && (
        <div className="hub-prompt" key={focusedStation.id}>
          <span className="hub-prompt__label">{focusedStation.label} · {focusedStation.sub}</span>
          <span className="hub-prompt__cta"><kbd>Enter</kbd> to dock — or click the node</span>
        </div>
      )}

      <HubHud selected={selected} onBack={() => setSelected(null)} onEnterRace={enterRace} />
    </div>
  );
}
