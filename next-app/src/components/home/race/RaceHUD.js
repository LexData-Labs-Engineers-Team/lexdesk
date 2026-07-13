'use client';

// The DOM half of the Nebula Grand Prix. Everything the pilot reads — lobby,
// rules, countdown, live telemetry, standings, minimap, podium — lives here in
// crisp accessible DOM over the canvas. Fast-moving readouts (speed, boost,
// minimap dots) are driven by rAF loops writing straight to the DOM, the same
// zero-re-render pattern the hub's radar uses.

import { useEffect, useRef, useState } from 'react';
import { getTrack, GATE_COUNT, LAPS } from './trackData';

/* The rulebook — shown on every grid, so nobody launches blind. */
export const RULES = [
  ['Grid', 'The race arms once 2 pilots are on the grid — it will not start solo.'],
  ['Course', `${LAPS} laps of the Nebula Circuit. Thread all ${GATE_COUNT} gates in order — the bright ring is always your next one.`],
  ['Contact', 'Bumping rivals is legal. Both ships scrub speed — use it wisely.'],
  ['Asteroids', 'Rocks on the racing line kill your pace. Thread or lose.'],
  ['Boost', 'Shift (or joystick rim) burns the boost cell. Chevron pads refill it instantly.'],
  ['Slipstream', 'Tuck in behind a rival to charge boost faster and gain top speed.'],
  ['Off-track', 'Outside the outer rails your engines choke. Press R to respawn at your last gate.'],
  ['Podium', 'First three across the line take the podium. Everyone’s time is recorded.'],
];

const PILOT_HUES = [0, 32, 58, 132, 174, 204, 262, 318];

const fmtTime = (ms) => {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(2);
  return `${m}:${String(s).padStart(5, '0')}`;
};
const ordinal = (n) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`);

// Project the circuit into a 120×120 viewbox once — shared by the racing
// minimap and the lobby's circuit preview.
let mapFit = null;
function getMapFit() {
  if (mapFit) return mapFit;
  const { samples, gates } = getTrack();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  samples.forEach((s) => {
    minX = Math.min(minX, s.p.x); maxX = Math.max(maxX, s.p.x);
    minZ = Math.min(minZ, s.p.z); maxZ = Math.max(maxZ, s.p.z);
  });
  const pad = 10, size = 120;
  const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  mapFit = {
    pts: samples.filter((_, i) => i % 6 === 0).map((s) =>
      `${(pad + (s.p.x - minX) * scale).toFixed(1)},${(pad + (s.p.z - minZ) * scale).toFixed(1)}`
    ).join(' '),
    map: (x, z) => [pad + (x - minX) * scale, pad + (z - minZ) * scale],
    gatePts: gates.map((g) => ({
      idx: g.idx,
      x: pad + (g.pos.x - minX) * scale,
      y: pad + (g.pos.z - minZ) * scale,
    })),
  };
  return mapFit;
}

/* ------------------------------------------------------------------ lobby */
// Static outline of the circuit with gate dots — the lobby's map table.
function CircuitPreview() {
  const fit = getMapFit();
  return (
    <div className="race-preview" aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <polygon points={fit.pts} className="race-map__track" />
        {fit.gatePts.map((g) => (
          <circle key={g.idx} cx={g.x} cy={g.y} r={g.idx === 0 ? 2.4 : 1.4} className={`race-map__gate${g.idx === 0 ? ' is-start' : ''}`} />
        ))}
      </svg>
    </div>
  );
}

export function RaceLobby({
  players, selfId, phase, countdownEndsAt, netRef, spectating,
  callsign, hue, onProfile, onReady, onExit, touch,
}) {
  const [name, setName] = useState(callsign);
  const [secs, setSecs] = useState(null);
  const [bestLap, setBestLap] = useState(0);
  const me = players.find((p) => p.id === selfId);
  const pilots = players.filter((p) => !p.spectator);
  const readyCount = pilots.filter((p) => p.ready).length;
  const circuitLen = Math.round(getTrack().length);

  useEffect(() => setName(callsign), [callsign]);
  useEffect(() => {
    try { setBestLap(parseInt(localStorage.getItem('teamos_best_lap') || '0', 10) || 0); } catch {}
  }, []);

  // armed-countdown ticker on server time
  useEffect(() => {
    if (phase !== 'armed' || !countdownEndsAt) { setSecs(null); return undefined; }
    const tick = () => {
      const nowS = netRef.current?.serverNow() ?? Date.now();
      setSecs(Math.max(0, Math.ceil((countdownEndsAt - nowS) / 1000)));
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [phase, countdownEndsAt, netRef]);

  const commitName = () => {
    const v = name.trim().slice(0, 14);
    if (v && v !== callsign) onProfile({ name: v });
  };

  const status = spectating
    ? 'Race in progress — you join the next grid.'
    : phase === 'armed'
      ? `Grid armed — launching in ${secs ?? '…'}s${readyCount === pilots.length ? '' : ' · all pilots ready launches sooner'}`
      : pilots.length < 2
        ? `Waiting for pilots — ${pilots.length} of 2 minimum`
        : 'Grid filling…';

  return (
    <div className="race-lobby">
      <div className="hub-panel glossy race-lobby__panel">
        <button type="button" onClick={onExit} className="hub-back" aria-label="Back to hub">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
          Back to hub
        </button>
        <span className="hub-panel__eyebrow">Nebula Grand Prix</span>
        <h2 className="race-lobby__title">Starting grid</h2>
        <p className={`race-lobby__status${phase === 'armed' ? ' is-armed' : ''}`} role="status">{status}</p>

        <div className="race-lobby__cols">
          <div>
            <div className="race-field">
              <label className="race-field__label" htmlFor="race-callsign">Callsign</label>
              <input
                id="race-callsign"
                className="race-field__input"
                value={name}
                maxLength={14}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') { commitName(); e.currentTarget.blur(); } }}
              />
            </div>
            <div className="race-field">
              <span className="race-field__label">Racing color</span>
              <div className="race-swatches" role="radiogroup" aria-label="Racing color">
                {PILOT_HUES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    role="radio"
                    aria-checked={hue === h}
                    className={`race-swatch${hue === h ? ' is-on' : ''}`}
                    style={{ '--pilot': `hsl(${h} 85% 62%)` }}
                    onClick={() => onProfile({ hue: h })}
                    aria-label={`Color ${h}`}
                  />
                ))}
              </div>
            </div>

            <ul className="race-roster">
              {players.map((p) => (
                <li key={p.id} className="race-roster__row" style={{ '--pilot': `hsl(${p.hue} 85% 62%)` }}>
                  <span className="race-roster__dot" />
                  <span className="race-roster__name">
                    {p.name}
                    {p.id === selfId && <em> · you</em>}
                  </span>
                  {p.spectator
                    ? <span className="race-roster__tag">next race</span>
                    : <span className={`race-roster__ready${p.ready ? ' is-on' : ''}`}>{p.ready ? 'READY' : 'waiting'}</span>}
                </li>
              ))}
              {players.length === 1 && (
                <li className="race-roster__row is-empty">
                  <span className="race-roster__name">Open slot — share the page, race a teammate</span>
                </li>
              )}
            </ul>

            {!spectating && (
              <button
                type="button"
                className={`btn-primary race-ready-btn${me?.ready ? ' is-on' : ''}`}
                onClick={() => onReady(!me?.ready)}
              >
                {me?.ready ? 'Ready — waiting for grid' : 'Ready up'}
              </button>
            )}
          </div>

          <div className="race-rules">
            <span className="race-rules__head">Nebula Circuit</span>
            <div className="race-lobby__circuit">
              <CircuitPreview />
              <div className="race-lobby__stats">
                <span className="race-chip">{LAPS} laps</span>
                <span className="race-chip">{GATE_COUNT} gates</span>
                <span className="race-chip">{circuitLen}u / lap</span>
                {bestLap > 0 && <span className="race-chip is-best">PB {fmtTime(bestLap)}</span>}
              </div>
            </div>
            <span className="race-rules__head">Race rules</span>
            <ul>
              {RULES.map(([k, v]) => (
                <li key={k}><strong>{k}</strong>{v}</li>
              ))}
            </ul>
            <p className="race-rules__controls">
              {touch
                ? 'Joystick to fly — push to the rim to boost.'
                : 'W/↑ thrust · A/D steer · Shift boost · R respawn'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- countdown */
export function Countdown({ startAt, netRef }) {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    if (!startAt) { setLabel(null); return undefined; }
    let raf;
    let last = null;
    const tick = () => {
      const remain = startAt - (netRef.current?.serverNow() ?? Date.now());
      let next = null;
      if (remain > 3000) next = 'GRID SET';
      else if (remain > 0) next = String(Math.ceil(remain / 1000));
      else if (remain > -900) next = 'GO';
      if (next !== last) { last = next; setLabel(next); }
      if (remain > -900) raf = requestAnimationFrame(tick);
      else setLabel(null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startAt, netRef]);
  if (!label) return null;
  return (
    <div className={`race-count${label === 'GO' ? ' is-go' : ''}`} key={label} aria-hidden="true">
      {label}
    </div>
  );
}

/* --------------------------------------------------- position / lap strip */
export function RaceStrip({ standings, selfId, telemetryRef }) {
  const [lap, setLap] = useState(1);
  const [gate, setGate] = useState(1);
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const tl = telemetryRef.current;
      setLap(tl.lap);
      setGate(tl.gate < 0 ? GATE_COUNT : tl.gate === 0 ? GATE_COUNT : tl.gate);
      setTicks(tl.finished ? GATE_COUNT : tl.passed % GATE_COUNT);
    }, 300);
    return () => clearInterval(t);
  }, [telemetryRef]);
  const pos = standings.findIndex((r) => r.id === selfId) + 1;
  return (
    <div className="race-strip-wrap" aria-hidden="true">
      <div className="race-strip">
        {pos > 0 && (
          <span className="race-strip__pos" key={pos}>
            P{pos}<em>/{standings.length}</em>
          </span>
        )}
        <span className="race-strip__cell">LAP {lap}<em>/{LAPS}</em></span>
        <span className="race-strip__cell">GATE {gate}<em>/{GATE_COUNT}</em></span>
      </div>
      {/* one tick per gate — refills every lap */}
      <div className="race-ticks">
        {Array.from({ length: GATE_COUNT }, (_, i) => (
          <span key={i} className={`race-tick${i < ticks ? ' is-on' : ''}`} />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- lap clock */
export function LapTimer({ telemetryRef }) {
  const curRef = useRef(null);
  const lastRef = useRef(null);
  const bestRef = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const tl = telemetryRef.current;
      if (curRef.current) {
        curRef.current.textContent = tl.lapStartPerf && !tl.finished
          ? fmtTime(performance.now() - tl.lapStartPerf)
          : '—';
      }
      if (lastRef.current) lastRef.current.textContent = tl.lastLapMs ? fmtTime(tl.lastLapMs) : '—';
      if (bestRef.current) bestRef.current.textContent = tl.bestLapMs ? fmtTime(tl.bestLapMs) : '—';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [telemetryRef]);
  return (
    <div className="race-timer" aria-hidden="true">
      <div className="race-timer__row is-cur"><span>LAP</span><strong ref={curRef}>—</strong></div>
      <div className="race-timer__row"><span>LAST</span><strong ref={lastRef}>—</strong></div>
      <div className="race-timer__row"><span>BEST</span><strong ref={bestRef}>—</strong></div>
    </div>
  );
}

/* --------------------------------------------------------- final lap flash */
export function FinalLapFlash({ telemetryRef }) {
  const [show, setShow] = useState(false);
  const seen = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const tl = telemetryRef.current;
      if (tl.lap === LAPS && !tl.finished && !seen.current) {
        seen.current = true;
        setShow(true);
        setTimeout(() => setShow(false), 2400);
      }
      if (tl.lap < LAPS) seen.current = false;
    }, 250);
    return () => clearInterval(t);
  }, [telemetryRef]);
  if (!show) return null;
  return <div className="race-flash" aria-hidden="true">FINAL LAP</div>;
}

/* --------------------------------------------------------- standings rail */
export function StandingsRail({ standings, players, selfId }) {
  if (!standings.length) return null;
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const leader = standings[0]?.prog ?? 0;
  return (
    <ol className="race-ladder" aria-label="Live standings">
      {standings.slice(0, 8).map((r, i) => {
        const p = byId[r.id];
        if (!p) return null;
        const gap = r.finished ? fmtTime(r.timeMs) : i === 0 ? 'leader' : `-${Math.max(0, leader - r.prog).toFixed(1)} gates`;
        return (
          <li
            key={r.id}
            className={`race-ladder__row${r.id === selfId ? ' is-you' : ''}${r.finished ? ' is-done' : ''}`}
            style={{ '--pilot': `hsl(${p.hue} 85% 62%)` }}
          >
            <span className="race-ladder__pos">{i + 1}</span>
            <span className="race-ladder__dot" />
            <span className="race-ladder__name">{p.name}</span>
            <span className="race-ladder__gap">{gap}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------- speed + boost readouts */
export function TelemetryBars({ telemetryRef }) {
  const speedRef = useRef(null);
  const boostRef = useRef(null);
  const flagsRef = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const tl = telemetryRef.current;
      if (speedRef.current) speedRef.current.style.transform = `scaleX(${tl.speed01.toFixed(3)})`;
      if (boostRef.current) {
        boostRef.current.style.transform = `scaleX(${tl.energy.toFixed(3)})`;
        boostRef.current.style.opacity = tl.boost ? '1' : '0.75';
      }
      if (flagsRef.current) {
        flagsRef.current.dataset.slip = tl.slip ? '1' : '';
        flagsRef.current.dataset.off = tl.off ? '1' : '';
        flagsRef.current.dataset.wrong = tl.wrong ? '1' : '';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [telemetryRef]);
  const numRef = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const tl = telemetryRef.current;
      if (numRef.current) numRef.current.textContent = String(Math.round(tl.speed01 * 41));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [telemetryRef]);
  return (
    <div className="race-telemetry" aria-hidden="true">
      <div ref={flagsRef} className="race-flags">
        <span className="race-flags__slip">SLIPSTREAM</span>
        <span className="race-flags__off">OFF TRACK — REJOIN</span>
        <span className="race-flags__wrong">WRONG WAY</span>
      </div>
      <div className="race-speednum">
        <strong ref={numRef}>0</strong>
        <span>u/s</span>
      </div>
      <div className="race-bar">
        <span className="race-bar__label">THRUST</span>
        <span className="race-bar__track"><span ref={speedRef} className="race-bar__fill" /></span>
      </div>
      <div className="race-bar">
        <span className="race-bar__label">BOOST</span>
        <span className="race-bar__track"><span ref={boostRef} className="race-bar__fill is-boost" /></span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- minimap */
export function TrackMap({ playersRef, shipStateRef, selfId, selfHue }) {
  const dotsRef = useRef(null);
  const fit = useRef(getMapFit());

  useEffect(() => {
    let raf;
    const tick = () => {
      const host = dotsRef.current;
      if (host) {
        const recs = [...playersRef.current.values()];
        const self = shipStateRef.current;
        const want = recs.length + (self ? 1 : 0);
        while (host.children.length < want) {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('r', '2.6');
          host.appendChild(c);
        }
        while (host.children.length > want) host.removeChild(host.lastChild);
        let i = 0;
        if (self) {
          const [x, y] = fit.current.map(self.x, self.z);
          const el = host.children[i++];
          el.setAttribute('cx', x); el.setAttribute('cy', y);
          el.setAttribute('fill', `hsl(${selfHue} 85% 65%)`);
          el.setAttribute('r', '3.2');
        }
        for (const rec of recs) {
          const [x, y] = fit.current.map(rec.cur.x, rec.cur.z);
          const el = host.children[i++];
          if (!el) break;
          el.setAttribute('cx', x); el.setAttribute('cy', y);
          el.setAttribute('fill', `hsl(${rec.hue} 85% 65%)`);
          el.setAttribute('r', '2.6');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playersRef, shipStateRef, selfHue, selfId]);

  return (
    <div className="race-map" aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <polygon points={fit.current.pts} className="race-map__track" />
        {fit.current.gatePts.map((g) => (
          <circle key={g.idx} cx={g.x} cy={g.y} r={g.idx === 0 ? 2.2 : 1.3} className={`race-map__gate${g.idx === 0 ? ' is-start' : ''}`} />
        ))}
        <g ref={dotsRef} />
      </svg>
      <span className="race-map__label">CIRCUIT</span>
    </div>
  );
}

/* ----------------------------------------------------------------- podium */
export function Podium({ results, selfId, onExit }) {
  if (!results) return null;
  const podium = results.filter((r) => !r.dnf).slice(0, 3);
  const rest = results.filter((r) => !podium.includes(r));
  return (
    <div className="race-podium-wrap">
      <div className="hub-panel glossy race-podium">
        <span className="hub-panel__eyebrow">Race complete</span>
        <h2 className="race-podium__title">Podium</h2>
        <div className="race-podium__tiers">
          {[1, 0, 2].map((slot) => {
            const r = podium[slot];
            if (!r) return <div key={slot} className="race-tier is-empty" />;
            return (
              <div key={r.id} className={`race-tier is-p${slot + 1}${r.id === selfId ? ' is-you' : ''}`} style={{ '--pilot': `hsl(${r.hue} 85% 62%)` }}>
                <span className="race-tier__place">{ordinal(slot + 1)}</span>
                <span className="race-tier__dot" />
                <span className="race-tier__name">{r.name}</span>
                <span className="race-tier__time">{fmtTime(r.timeMs)}</span>
              </div>
            );
          })}
        </div>
        {rest.length > 0 && (
          <ul className="race-podium__rest">
            {rest.map((r, i) => (
              <li key={r.id} style={{ '--pilot': `hsl(${r.hue} 85% 62%)` }}>
                <span>{r.dnf ? 'DNF' : ordinal(podium.length + i + 1)}</span>
                <span className="race-tier__dot" />
                {r.name}
                {!r.dnf && <em>{fmtTime(r.timeMs)}</em>}
              </li>
            ))}
          </ul>
        )}
        <p className="race-podium__note">Next grid opens in a moment — stay put to race again.</p>
        <div className="race-podium__actions">
          <button type="button" className="hub-ghost" onClick={onExit}>Back to hub</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- finish banner */
export function FinishBanner({ place }) {
  if (!place) return null;
  return (
    <div className="race-finish" aria-hidden="true">
      <span className="race-finish__place">{ordinal(place)}</span>
      <span className="race-finish__sub">across the line — waiting on the field</span>
    </div>
  );
}
