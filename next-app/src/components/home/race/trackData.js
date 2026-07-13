'use client';

// The Nebula Circuit — a single hand-tuned closed spline that every client
// rebuilds identically, so the whole grid races the exact same ribbon of light.
// Gates, boost pads and the start arch are derived from the curve; asteroid
// fields are generated from a seed the server hands out per race, which keeps
// obstacle layouts in perfect sync across machines with zero geometry traffic.

import * as THREE from 'three';

export const GATE_COUNT = 12;   // holo-rings you must thread, in order
export const LAPS = 3;          // laps to the checkered flag
export const CORRIDOR = 13;     // half-width of the legal racing corridor
export const GATE_RADIUS = 5.2; // pass detection radius around a gate center

// Sweeping figure-flow loop with real elevation change — long straights for
// slipstream duels, a tight hairpin, and a high crest before the finish dive.
const CONTROL_POINTS = [
  [0, 2, -78], [52, 3, -102], [108, 7, -70], [128, 12, -6],
  [102, 18, 62], [44, 10, 92], [-28, 5, 104], [-92, 9, 76],
  [-126, 16, 12], [-108, 22, -58], [-52, 12, -96], [-20, 4, -86],
];

const SAMPLE_COUNT = 768;

let cached = null;

// Build (once) the curve + everything derived from it.
export function getTrack() {
  if (cached) return cached;

  const pts = CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.85);
  const length = curve.getLength();

  // Dense uniform samples for nearest-point lookups, the minimap and rails.
  const samples = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    // Lateral direction on the track plane (tangent × up).
    const nrm = new THREE.Vector3().crossVectors(tan, UP).normalize();
    samples.push({ t, p, tan, nrm });
  }

  const gates = [];
  for (let i = 0; i < GATE_COUNT; i++) {
    const t = i / GATE_COUNT;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), tan, UP)
    );
    gates.push({ idx: i, t, pos: p, quat: q, tan });
  }

  // Boost chevrons sit on the racing line between gates.
  const pads = [0.055, 0.21, 0.3, 0.475, 0.635, 0.72, 0.885].map((t, i) => {
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), tan, UP)
    );
    return { idx: i, t, pos: p, quat: q };
  });

  cached = { curve, samples, gates, pads, length, start: gates[0] };
  return cached;
}

const UP = new THREE.Vector3(0, 1, 0);

// Deterministic PRNG — same seed, same asteroid belt, on every client.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scatter rocks along the corridor — some drift right on the racing line, but
// never inside a gate ring or on top of a boost pad, and never on the grid.
export function genObstacles(seed, count) {
  const { curve, gates, pads } = getTrack();
  const rand = mulberry32(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 30) {
    const t = rand();
    const nearGate = gates.some((g) => Math.abs(wrapDelta(t - g.t)) < 0.016);
    const nearPad = pads.some((p) => Math.abs(wrapDelta(t - p.t)) < 0.012);
    const onGrid = t > 0.94 || t < 0.03; // keep the start straight clean
    if (nearGate || nearPad || onGrid) continue;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nrm = new THREE.Vector3().crossVectors(tan, UP).normalize();
    // Keep the racing line itself breathable: rocks sit at least ~4 units off
    // center, so there is always a flyable lane — hugging the edges is the risk.
    const side = rand() < 0.5 ? -1 : 1;
    const lateral = side * (4 + rand() * (CORRIDOR - 5.5));
    const lift = -1 + rand() * 4.5;
    const pos = p.clone().addScaledVector(nrm, lateral);
    pos.y += lift;
    out.push({
      pos,
      r: 0.7 + rand() * 1.7,
      rot: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
      spin: (rand() - 0.5) * 0.9,
      detail: rand() > 0.7 ? 1 : 0,
    });
  }
  return out;
}

function wrapDelta(d) {
  // shortest signed distance between two curve parameters on a loop
  if (d > 0.5) return d - 1;
  if (d < -0.5) return d + 1;
  return d;
}

// Nearest sample index to a world position, searched locally around a hint so
// the per-frame cost stays tiny. Falls back to a full scan when lost.
export function nearestSample(pos, hintIdx = 0) {
  const { samples } = getTrack();
  const n = samples.length;
  let best = hintIdx;
  let bestD = samples[best].p.distanceToSquared(pos);
  let improved = true;
  let range = 24;
  while (improved) {
    improved = false;
    for (let o = -range; o <= range; o++) {
      const i = ((best + o) % n + n) % n;
      const d = samples[i].p.distanceToSquared(pos);
      if (d < bestD - 1e-6) { bestD = d; best = i; improved = true; }
    }
    range = 8;
  }
  // If we're wildly far from the hint region, do one coarse global pass.
  if (bestD > 60 * 60) {
    for (let i = 0; i < n; i += 6) {
      const d = samples[i].p.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

// Starting grid slot for a pilot: 2 columns × N rows behind the start line.
export function gridSlot(index) {
  const { start } = getTrack();
  const row = Math.floor(index / 2);
  const col = index % 2 === 0 ? -1 : 1;
  const nrm = new THREE.Vector3().crossVectors(start.tan, UP).normalize();
  const pos = start.pos.clone()
    .addScaledVector(start.tan, -(7 + row * 5.5))
    .addScaledVector(nrm, col * 2.6);
  return { pos, heading: Math.atan2(start.tan.x, start.tan.z) };
}
