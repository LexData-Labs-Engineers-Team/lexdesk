'use client';

// The Grand Prix circuits — hand-tuned closed splines that every client (and
// the arena engine, and the AI pilots) rebuild identically. Gates, boost pads,
// pickup pods and the start arch derive from each curve; asteroid fields are
// generated from a seed the server hands out per race, which keeps obstacle
// layouts in perfect sync across machines with zero geometry traffic.

import * as THREE from 'three';

export const GATE_COUNT = 12;   // holo-rings you must thread, in order
export const LAPS = 3;          // laps to the checkered flag
export const CORRIDOR = 13;     // half-width of the legal racing corridor
export const GATE_RADIUS = 5.2; // pass detection radius around a gate center

// Three circuits, three characters:
//   0 Nebula Circuit — the classic: sweeping figure-flow, a hairpin, a crest.
//   1 Ion Straits    — a speed bowl: two monster straights for slipstream
//                      drag-races, joined by fast 180s and one chicane kink.
//   2 Helix Falls    — the technical one: tight footprint, huge elevation
//                      swings — a climbing spiral and a diving return.
export const TRACKS = [
  {
    id: 0,
    name: 'Nebula Circuit',
    tension: 0.85,
    points: [
      [0, 2, -78], [52, 3, -102], [108, 7, -70], [128, 12, -6],
      [102, 18, 62], [44, 10, 92], [-28, 5, 104], [-92, 9, 76],
      [-126, 16, 12], [-108, 22, -58], [-52, 12, -96], [-20, 4, -86],
    ],
    padTs: [0.055, 0.21, 0.3, 0.475, 0.635, 0.72, 0.885],
    pickupTs: [0.13, 0.37, 0.58, 0.8],
  },
  {
    id: 1,
    name: 'Ion Straits',
    tension: 0.7,
    points: [
      [-130, 3, -40], [-60, 2, -52], [40, 4, -50], [120, 3, -42],
      [152, 7, 0], [120, 4, 42], [30, 2, 54], [-42, 7, 42],
      [-92, 3, 56], [-142, 6, 16],
    ],
    padTs: [0.08, 0.2, 0.32, 0.55, 0.68, 0.82],
    pickupTs: [0.15, 0.44, 0.62, 0.9],
  },
  {
    id: 2,
    name: 'Helix Falls',
    tension: 0.9,
    points: [
      [0, 24, -70], [55, 18, -55], [82, 10, 0], [55, 4, 56],
      [0, 2, 76], [-52, 8, 56], [-78, 16, 8], [-58, 26, -36],
      [-20, 30, -62],
    ],
    padTs: [0.1, 0.3, 0.52, 0.74, 0.9],
    pickupTs: [0.2, 0.45, 0.65, 0.85],
  },
];

export const TRACK_COUNT = TRACKS.length;
const clampTrackId = (id) => (Number.isInteger(id) && id >= 0 && id < TRACKS.length ? id : 0);

const SAMPLE_COUNT = 768;
const UP = new THREE.Vector3(0, 1, 0);

const cached = new Map(); // trackId -> built track

// Build (once per circuit) the curve + everything derived from it.
export function getTrack(trackId = 0) {
  const tid = clampTrackId(trackId);
  if (cached.has(tid)) return cached.get(tid);
  const def = TRACKS[tid];

  const pts = def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', def.tension);
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

  const orient = (t) => {
    const tan = curve.getTangentAt(t);
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), tan, UP)
    );
  };

  const gates = [];
  for (let i = 0; i < GATE_COUNT; i++) {
    const t = i / GATE_COUNT;
    gates.push({ idx: i, t, pos: curve.getPointAt(t), quat: orient(t), tan: curve.getTangentAt(t) });
  }

  // Boost chevrons sit on the racing line between gates.
  const pads = def.padTs.map((t, i) => ({ idx: i, t, pos: curve.getPointAt(t), quat: orient(t) }));

  // Pickup pods float just OFF the racing line (alternating sides), so
  // grabbing one is a deliberate detour, not a freebie.
  const pickups = def.pickupTs.map((t, i) => {
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nrm = new THREE.Vector3().crossVectors(tan, UP).normalize();
    const side = i % 2 === 0 ? -1 : 1;
    const pos = p.clone().addScaledVector(nrm, side * 4.6);
    pos.y += 0.6;
    return { idx: i, t, pos, side };
  });

  const built = { id: tid, name: def.name, curve, samples, gates, pads, pickups, length, start: gates[0] };
  cached.set(tid, built);
  return built;
}

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

// The three pickup kinds, dealt per race from the shared seed so every client
// (and the engine) agrees on what's floating where without any extra traffic.
export const PICKUP_KINDS = ['shield', 'overcharge', 'emp'];
export function dealPickupKinds(seed, trackId = 0) {
  const { pickups } = getTrack(trackId);
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return pickups.map(() => PICKUP_KINDS[Math.floor(rand() * PICKUP_KINDS.length)]);
}

// Scatter rocks along the corridor — some drift right on the racing line, but
// never inside a gate ring, on a boost pad or a pickup pod, and never on the
// grid. Count is part of the shared contract — identical for every client.
export function genObstacles(seed, count, trackId = 0) {
  const { curve, gates, pads, pickups } = getTrack(trackId);
  const rand = mulberry32(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 30) {
    const t = rand();
    const nearGate = gates.some((g) => Math.abs(wrapDelta(t - g.t)) < 0.016);
    const nearPad = pads.some((p) => Math.abs(wrapDelta(t - p.t)) < 0.012);
    const nearPickup = pickups.some((p) => Math.abs(wrapDelta(t - p.t)) < 0.012);
    const onGrid = t > 0.94 || t < 0.03; // keep the start straight clean
    if (nearGate || nearPad || nearPickup || onGrid) continue;
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
export function nearestSample(pos, hintIdx = 0, trackId = 0) {
  const { samples } = getTrack(trackId);
  const n = samples.length;
  let best = ((hintIdx % n) + n) % n;
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
export function gridSlot(index, trackId = 0) {
  const { start } = getTrack(trackId);
  const row = Math.floor(index / 2);
  const col = index % 2 === 0 ? -1 : 1;
  const nrm = new THREE.Vector3().crossVectors(start.tan, UP).normalize();
  const pos = start.pos.clone()
    .addScaledVector(start.tan, -(7 + row * 5.5))
    .addScaledVector(nrm, col * 2.6);
  return { pos, heading: Math.atan2(start.tan.x, start.tan.z) };
}
