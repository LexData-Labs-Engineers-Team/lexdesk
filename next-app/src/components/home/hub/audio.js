'use client';

// Tiny synthesized sound engine for the hub — no audio files, just Web Audio
// oscillators, so it stays offline and weightless. Browsers block audio until a
// user gesture, so we lazily create the context on the first key/click (init()).

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq, dur = 0.25, type = 'sine', gain = 0.18, slideTo = null, delay = 0 }) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// A continuous low ambient pad: three detuned oscillators through a lowpass
// filter whose cutoff drifts via a slow LFO — a gentle "space drone". Routed
// through master, so muting silences it too.
let ambient = null;
function startAmbient() {
  const c = ensure();
  if (!c || !master || ambient) return;
  const g = c.createGain();
  g.gain.value = 0.0001;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  filter.Q.value = 1.2;
  const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
  const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 82.41;
  const o3 = c.createOscillator(); o3.type = 'sine'; o3.frequency.value = 110;
  const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05;
  const lfoGain = c.createGain(); lfoGain.gain.value = 140;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  o1.connect(filter); o2.connect(filter); o3.connect(filter);
  filter.connect(g);
  g.connect(master);
  o1.start(); o2.start(); o3.start(); lfo.start();
  g.gain.exponentialRampToValueAtTime(0.08, c.currentTime + 3.5); // slow fade-in
  ambient = { g, nodes: [o1, o2, o3, lfo] };
}
function stopAmbient() {
  if (!ambient || !ctx) return;
  const a = ambient;
  ambient = null;
  try {
    a.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    a.nodes.forEach((n) => { try { n.stop(ctx.currentTime + 0.6); } catch {} });
  } catch {}
}

// Continuous engine tone whose pitch + brightness + volume track ship speed.
let engine = null;
function engineStart() {
  const c = ensure();
  if (!c || !master || engine) return;
  const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60;
  const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = 30;
  const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 380; filter.Q.value = 2;
  const g = c.createGain(); g.gain.value = 0.0001;
  osc.connect(filter); sub.connect(filter); filter.connect(g); g.connect(master);
  osc.start(); sub.start();
  engine = { osc, sub, filter, g };
}
function engineSet(speed01, boost) {
  if (!engine || !ctx) return;
  const t = ctx.currentTime;
  const s = Math.max(0, Math.min(1, speed01));
  const freq = 55 + s * 150 + (boost ? 50 : 0);
  engine.osc.frequency.setTargetAtTime(freq, t, 0.08);
  engine.sub.frequency.setTargetAtTime(freq / 2, t, 0.08);
  engine.filter.frequency.setTargetAtTime(300 + s * 1300, t, 0.1);
  engine.g.gain.setTargetAtTime(Math.max(0.0001, 0.0001 + s * 0.05 + (boost ? 0.02 : 0)), t, 0.1);
}
function engineStop() {
  if (!engine || !ctx) return;
  const e = engine;
  engine = null;
  try {
    e.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
    e.osc.stop(ctx.currentTime + 0.3);
    e.sub.stop(ctx.currentTime + 0.3);
  } catch {}
}

// One reusable noise buffer for whoosh bursts.
let noiseBuf = null;
function getNoise(c) {
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.4);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

export const audio = {
  init: () => ensure(),
  startAmbient,
  stopAmbient,
  engineStart,
  engineSet,
  engineStop,
  // asteroid near-miss — a filtered-noise whoosh that sweeps down (doppler-ish)
  whoosh: () => {
    const c = ensure();
    if (!c || !master) return;
    const t0 = c.currentTime;
    const dur = 0.34;
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(1500, t0);
    bp.frequency.exponentialRampToValueAtTime(320, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  },
  // new high-score — a short triumphant arpeggio
  fanfare: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.13, delay: i * 0.09 }));
  },
  // collecting an orb — a bright rising pluck
  collect: () => tone({ freq: 1046, dur: 0.12, type: 'sine', gain: 0.11, slideTo: 1568 }),
  setMuted: (m) => {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  },
  isMuted: () => muted,
  // arrival at a station — a warm two-note ascending chime
  dock: () => {
    tone({ freq: 392, dur: 0.18, type: 'triangle', gain: 0.16 });
    tone({ freq: 587, dur: 0.32, type: 'triangle', gain: 0.15, delay: 0.09 });
  },
  // leaving a station — a soft descending pair
  undock: () => {
    tone({ freq: 523, dur: 0.14, type: 'sine', gain: 0.1 });
    tone({ freq: 330, dur: 0.22, type: 'sine', gain: 0.1, delay: 0.06 });
  },
  // a node has entered docking range — a tiny high blip
  blip: () => tone({ freq: 880, dur: 0.07, type: 'sine', gain: 0.06 }),
  // boost engaged — a low rising sweep
  boost: () => tone({ freq: 150, dur: 0.35, type: 'sawtooth', gain: 0.05, slideTo: 320 }),

  /* ------- race mode ------- */
  // countdown tick — a clipped square pip
  count: () => tone({ freq: 660, dur: 0.09, type: 'square', gain: 0.08 }),
  // GO — a hard rising blast
  go: () => {
    tone({ freq: 523, dur: 0.5, type: 'sawtooth', gain: 0.12, slideTo: 1046 });
    tone({ freq: 262, dur: 0.5, type: 'square', gain: 0.07, slideTo: 523 });
  },
  // threading a gate — a clean two-note confirmation
  gate: () => {
    tone({ freq: 740, dur: 0.09, type: 'triangle', gain: 0.12 });
    tone({ freq: 1108, dur: 0.16, type: 'triangle', gain: 0.1, delay: 0.05 });
  },
  // hull contact (rock or rival) — a dull metallic thud
  clank: () => {
    const c = ensure();
    if (!c || !master) return;
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + 0.26);
    tone({ freq: 90, dur: 0.18, type: 'sine', gain: 0.14, slideTo: 45 });
  },
  // boost pad pickup — an energized upward zip
  pad: () => tone({ freq: 880, dur: 0.18, type: 'sawtooth', gain: 0.08, slideTo: 1760 }),
  // final lap bell
  bell: () => {
    tone({ freq: 1318, dur: 0.4, type: 'triangle', gain: 0.12 });
    tone({ freq: 1318, dur: 0.4, type: 'triangle', gain: 0.1, delay: 0.22 });
  },
  // a rival blows past at speed — filtered noise swelling then falling away
  whoosh: () => {
    const c = ensure();
    if (!c || !master) return;
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(1400, t0 + 0.12);
    bp.frequency.exponentialRampToValueAtTime(200, t0 + 0.38);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + 0.42);
  },
  // shield arming / absorbing a hit — a glassy shimmer
  shield: () => {
    tone({ freq: 1568, dur: 0.22, type: 'sine', gain: 0.09 });
    tone({ freq: 2093, dur: 0.3, type: 'sine', gain: 0.07, delay: 0.06 });
  },
  // EMP shock — a harsh falling zap
  emp: () => {
    tone({ freq: 1200, dur: 0.28, type: 'sawtooth', gain: 0.1, slideTo: 80 });
    tone({ freq: 600, dur: 0.22, type: 'square', gain: 0.06, slideTo: 60 });
  },
  // gaining a place — a quick rising two-note
  overtake: () => {
    tone({ freq: 659, dur: 0.09, type: 'triangle', gain: 0.09 });
    tone({ freq: 988, dur: 0.14, type: 'triangle', gain: 0.08, delay: 0.06 });
  },
  // losing a place — the inverse, softer
  overtaken: () => {
    tone({ freq: 659, dur: 0.09, type: 'sine', gain: 0.06 });
    tone({ freq: 440, dur: 0.14, type: 'sine', gain: 0.06, delay: 0.06 });
  },
};
