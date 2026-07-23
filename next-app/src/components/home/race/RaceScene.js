'use client';

// The Nebula Grand Prix arena — the 3D half of the race. A neon spline circuit
// floats in open space: holo-gate rings to thread in order, a seeded asteroid
// belt shared by every client, boost chevrons on the racing line, and rival
// ships streamed over the wire and rendered through a 110 ms interpolation
// buffer so their motion is smooth despite ~12 Hz updates. All per-frame data
// flows through refs (never React state), matching the hub's architecture.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Html, Trail, Grid } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { ChromaticAberrationEffect } from 'postprocessing';
import { getTrack, genObstacles, nearestSample, gridSlot, GATE_COUNT, LAPS, CORRIDOR, GATE_RADIUS } from './trackData.mjs';
import { audio } from '../hub/audio';

const smooth = (delta, rate = 3.2) => 1 - Math.exp(-rate * delta);
const UP = new THREE.Vector3(0, 1, 0);
const INTERP_DELAY_MS = 110; // remote ships render this far in the past
const RAIL_OFFSET = 7.5;

const shortestAngle = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const pilotColor = (hue, l = 0.62) => new THREE.Color().setHSL(((hue % 360) + 360) % 360 / 360, 0.85, l);

/* ------------------------------------------------------------- ship visual */
// The hub's ship silhouette, re-cut for racing: white hull, but wings, engine
// and trail carry the pilot's hue — the only color in the arena is people.
// `lit` — whether this ship carries its own pointLight. The local pilot always
// does; remote ships drop theirs on lowPerf rigs, where 6-8 extra dynamic
// lights against MeshStandardMaterials is the difference between 60 and 25 fps.
function RaceShipMesh({ hue, glowRef, trailLength = 7, lit = true }) {
  const accent = useMemo(() => pilotColor(hue), [hue]);
  const accentBright = useMemo(() => pilotColor(hue, 0.72), [hue]);
  return (
    <group scale={0.95}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.18, 0.7, 8, 20]} />
        <meshStandardMaterial color="#eef1f5" metalness={0.92} roughness={0.18} envMapIntensity={1.2} />
      </mesh>
      <mesh position={[0, 0, 0.62]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.18, 0.4, 20]} />
        <meshStandardMaterial color="#ffffff" metalness={0.92} roughness={0.14} />
      </mesh>
      <mesh position={[0, -0.04, -0.05]}>
        <boxGeometry args={[1.3, 0.05, 0.36]} />
        <meshStandardMaterial color={accent} metalness={0.7} roughness={0.3} emissive={accent} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.16, -0.42]}>
        <boxGeometry args={[0.05, 0.34, 0.3]} />
        <meshStandardMaterial color={accent} metalness={0.7} roughness={0.3} emissive={accent} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.12, 0.18]}>
        <sphereGeometry args={[0.16, 20, 20]} />
        <meshStandardMaterial color="#7f8893" metalness={1} roughness={0.05} envMapIntensity={1.5} />
      </mesh>
      <mesh ref={glowRef} position={[0, 0, -0.62]}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshBasicMaterial color={accentBright} />
      </mesh>
      <Trail width={2.6} length={trailLength} color={accentBright} attenuation={(t) => t * t} decay={1.5}>
        <mesh position={[0, 0, -0.7]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshBasicMaterial color={accentBright} />
        </mesh>
      </Trail>
      {lit && <pointLight position={[0, 0.1, -0.85]} color={accentBright} intensity={6} distance={7} />}
    </group>
  );
}

/* ------------------------------------------------------------ track ribbon */
function TrackRibbon() {
  const track = getTrack();

  // Faint road surface between the rails — a strip of quads along the samples.
  const surface = useMemo(() => {
    const { samples } = track;
    const n = samples.length;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const s = samples[i % n];
      const o = i * 6;
      pos[o] = s.p.x - s.nrm.x * RAIL_OFFSET; pos[o + 1] = s.p.y - 0.5; pos[o + 2] = s.p.z - s.nrm.z * RAIL_OFFSET;
      pos[o + 3] = s.p.x + s.nrm.x * RAIL_OFFSET; pos[o + 4] = s.p.y - 0.5; pos[o + 5] = s.p.z + s.nrm.z * RAIL_OFFSET;
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [track]);

  // A narrower, brighter centre lane laid over the wide faint apron — gives the
  // road a lit racing line instead of one flat translucent sheet.
  const centreLane = useMemo(() => {
    const { samples } = track;
    const n = samples.length;
    const w = RAIL_OFFSET * 0.5;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const s = samples[i % n];
      const o = i * 6;
      pos[o] = s.p.x - s.nrm.x * w; pos[o + 1] = s.p.y - 0.48; pos[o + 2] = s.p.z - s.nrm.z * w;
      pos[o + 3] = s.p.x + s.nrm.x * w; pos[o + 4] = s.p.y - 0.48; pos[o + 5] = s.p.z + s.nrm.z * w;
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }, [track]);

  // Glowing edge rails as thin tubes (not flat lines) so they read as light.
  const railTubes = useMemo(() => {
    const { samples } = track;
    const mk = (offset) => {
      const pts = samples.filter((_, i) => i % 4 === 0).map((s) =>
        new THREE.Vector3(s.p.x + s.nrm.x * offset, s.p.y - 0.34, s.p.z + s.nrm.z * offset));
      const c = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
      return new THREE.TubeGeometry(c, 256, 0.13, 6, true);
    };
    return [mk(-RAIL_OFFSET), mk(RAIL_OFFSET)];
  }, [track]);

  // Faint outer-corridor boundary (the point past which engines choke).
  const corridorLines = useMemo(() => {
    const { samples } = track;
    const mk = (offset) => {
      const pos = new Float32Array(samples.length * 3);
      samples.forEach((s, i) => {
        pos[i * 3] = s.p.x + s.nrm.x * offset;
        pos[i * 3 + 1] = s.p.y - 0.35;
        pos[i * 3 + 2] = s.p.z + s.nrm.z * offset;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      return g;
    };
    return [mk(-CORRIDOR), mk(CORRIDOR)];
  }, [track]);

  const core = useMemo(() => new THREE.TubeGeometry(track.curve, 512, 0.1, 6, true), [track]);

  return (
    <group>
      <mesh geometry={surface}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.05} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={centreLane}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={core} position={[0, -0.45, 0]}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {railTubes.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {corridorLines.map((g, i) => (
        <lineLoop key={i} geometry={g}>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
        </lineLoop>
      ))}
    </group>
  );
}

// Pulses of light that travel the circuit forever — the track feels powered.
function PulseRunners({ count = 12 }) {
  const track = getTrack();
  const refs = useRef([]);
  const seeds = useMemo(
    () => Array.from({ length: count }, (_, i) => ({ t0: i / count, v: 0.012 + (i % 3) * 0.004 })),
    [count]
  );
  useFrame((st) => {
    for (let i = 0; i < seeds.length; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const t = (seeds[i].t0 + st.clock.elapsedTime * seeds[i].v) % 1;
      const p = track.curve.getPointAt(t);
      m.position.set(p.x, p.y - 0.45, p.z);
    }
  });
  return (
    <group>
      {seeds.map((_, i) => (
        <group key={i} ref={(el) => { refs.current[i] = el; }}>
          <mesh>
            <sphereGeometry args={[0.17, 8, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.5, 10, 10]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ gates */
function Gate({ data, gateStateRef }) {
  const ring = useRef();
  const mat = useRef();
  const halo = useRef();
  const beam = useRef();
  const disc = useRef();
  useFrame((st, delta) => {
    const gs = gateStateRef.current;
    const isNext = gs.next === data.idx && !gs.finished;
    const wave = Math.sin(st.clock.elapsedTime * 4.5);
    const pulse = isNext ? 1 + wave * 0.04 : 1;
    if (ring.current) ring.current.scale.setScalar(THREE.MathUtils.damp(ring.current.scale.x, pulse, 8, delta));
    if (mat.current) {
      const target = isNext ? 2.2 : 0.55;
      mat.current.emissiveIntensity = THREE.MathUtils.damp(mat.current.emissiveIntensity, target, 6, delta);
    }
    if (halo.current) halo.current.material.opacity = THREE.MathUtils.damp(halo.current.material.opacity, isNext ? 0.5 : 0.16, 6, delta);
    if (beam.current) beam.current.material.opacity = THREE.MathUtils.damp(beam.current.material.opacity, isNext ? 0.42 : 0, 6, delta);
    // Inner membrane shimmers on the active gate — a portal you punch through.
    if (disc.current) {
      const target = isNext ? 0.14 + wave * 0.05 : 0.035;
      disc.current.material.opacity = THREE.MathUtils.damp(disc.current.material.opacity, target, 6, delta);
    }
  });
  return (
    <group position={data.pos} quaternion={data.quat}>
      {/* bright structural ring */}
      <mesh ref={ring}>
        <torusGeometry args={[4.6, 0.11, 14, 80]} />
        <meshStandardMaterial ref={mat} color="#ffffff" metalness={0.5} roughness={0.25} emissive="#ffffff" emissiveIntensity={0.55} />
      </mesh>
      {/* soft additive halo ring just outside it */}
      <mesh ref={halo}>
        <torusGeometry args={[4.62, 0.32, 8, 80]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* inner membrane */}
      <mesh ref={disc}>
        <circleGeometry args={[4.5, 44]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.035} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* locator beam — visible across the arena, only on the next gate */}
      <mesh ref={beam} position={[0, 26, 0]}>
        <cylinderGeometry args={[0.06, 0.5, 52, 10, 1, true]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function StartArch() {
  const { start } = getTrack();
  return (
    <group position={start.pos} quaternion={start.quat}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (RAIL_OFFSET + 0.6), 2.4, 0]}>
          <boxGeometry args={[0.5, 7.8, 0.5]} />
          <meshStandardMaterial color="#d7dce3" metalness={0.85} roughness={0.25} emissive="#ffffff" emissiveIntensity={0.12} />
        </mesh>
      ))}
      <mesh position={[0, 6.5, 0]}>
        <boxGeometry args={[(RAIL_OFFSET + 0.85) * 2, 0.7, 0.7]} />
        <meshStandardMaterial color="#ffffff" metalness={0.5} roughness={0.3} emissive="#ffffff" emissiveIntensity={0.7} />
      </mesh>
      <pointLight position={[0, 6, 0]} intensity={8} distance={22} color="#ffffff" />
    </group>
  );
}

/* -------------------------------------------------------------- boost pads */
function BoostPads({ padFxRef }) {
  const { pads } = getTrack();
  const mats = useRef([]);
  useFrame((st, delta) => {
    for (let i = 0; i < pads.length; i++) {
      const m = mats.current[i];
      if (!m) continue;
      const flash = padFxRef.current[i] && st.clock.elapsedTime - padFxRef.current[i] < 0.5 ? 2.4 : 0;
      const target = 0.55 + Math.sin(st.clock.elapsedTime * 3 + i * 1.7) * 0.25 + flash;
      m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, target, 8, delta);
    }
  });
  return (
    <group>
      {pads.map((pad, i) => (
        <group key={i} position={pad.pos} quaternion={pad.quat}>
          {[0, 1].map((j) => (
            <mesh key={j} position={[0, -0.3, -j * 1.6]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[1.1, 2.4, 3]} />
              <meshStandardMaterial
                ref={(el) => { if (j === 0) mats.current[i] = el; }}
                color="#ffffff" metalness={0.2} roughness={0.4}
                emissive="#ffffff" emissiveIntensity={0.55}
                transparent opacity={0.85}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------- asteroid field */
function ObstacleField({ obstacles }) {
  const inst = useRef();
  useLayoutEffect(() => {
    if (!inst.current) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    obstacles.forEach((o, i) => {
      e.set(o.rot[0], o.rot[1], o.rot[2]);
      q.setFromEuler(e);
      m.compose(o.pos, q, new THREE.Vector3(o.r, o.r, o.r));
      inst.current.setMatrixAt(i, m);
    });
    inst.current.instanceMatrix.needsUpdate = true;
    inst.current.computeBoundingSphere();
  }, [obstacles]);
  return (
    <instancedMesh ref={inst} args={[undefined, undefined, obstacles.length]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#878d97" metalness={0.45} roughness={0.8} flatShading />
    </instancedMesh>
  );
}

/* ----------------------------------------------------------- impact sparks */
function ImpactBursts({ fxRef }) {
  const [, bump] = useState(0);
  const prevSig = useRef('');
  useFrame((st) => {
    // Retire old bursts and re-render when the SET changes. Comparing only the
    // length missed the case where one burst expires while another is appended
    // in the same frame (equal length, different members) — so we key off a
    // signature of length + newest key instead.
    const cur = fxRef.current;
    const alive = cur.filter((f) => st.clock.elapsedTime - f.born < 0.6);
    if (alive.length !== cur.length) fxRef.current = alive;
    const sig = `${alive.length}:${alive.length ? alive[alive.length - 1].key : ''}`;
    if (sig !== prevSig.current) { prevSig.current = sig; bump((x) => x + 1); }
  });
  return (
    <group>
      {fxRef.current.map((f) => <Burst key={f.key} fx={f} />)}
    </group>
  );
}
function Burst({ fx }) {
  const ref = useRef();
  const mat = useRef();
  const { camera } = useThree();
  useFrame((st) => {
    const t = Math.min((st.clock.elapsedTime - fx.born) / 0.55, 1);
    if (ref.current) {
      ref.current.scale.setScalar(0.6 + t * 4.2);
      ref.current.quaternion.copy(camera.quaternion); // billboard
    }
    if (mat.current) mat.current.opacity = (1 - t) * 0.8;
  });
  return (
    <mesh ref={ref} position={fx.pos}>
      <ringGeometry args={[0.55, 0.72, 28]} />
      <meshBasicMaterial ref={mat} color="#ffffff" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ------------------------------------------------------------ remote ships */
function RemoteShip({ rec, netRef, lowPerf }) {
  const group = useRef();
  const glow = useRef();
  // Mount the mesh only once the ship has a real position: drei's <Trail>
  // samples its target even while an ancestor is invisible, so mounting at the
  // origin pre-snapshot painted a full-arena streak on the ship's first frame.
  const [placed, setPlaced] = useState(!!rec.placed);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const buf = rec.buf;
    // No snapshots yet (a rival who just joined the grid, or a paused feed):
    // keep the whole ship hidden rather than parking it at the world origin.
    if (!buf.length) { g.visible = false; return; }
    g.visible = true;
    const renderT = (netRef.current?.serverNow() ?? Date.now()) - INTERP_DELAY_MS;

    // Find the snapshot pair bracketing renderT and interpolate; if we're past
    // the newest snapshot, extrapolate along the ship's heading (capped).
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let i = buf.length - 2; i >= 0; i--) {
      if (buf[i].t <= renderT) { a = buf[i]; b = buf[i + 1]; break; }
    }
    let x, y, z, h, k, s;
    if (renderT <= b.t && b.t > a.t) {
      const f = THREE.MathUtils.clamp((renderT - a.t) / (b.t - a.t), 0, 1);
      x = a.x + (b.x - a.x) * f;
      y = a.y + (b.y - a.y) * f;
      z = a.z + (b.z - a.z) * f;
      h = a.h + shortestAngle(a.h, b.h) * f;
      k = a.k + (b.k - a.k) * f;
      s = a.s + (b.s - a.s) * f;
    } else {
      // clamp to [0, 0.25]: a single-entry buffer makes renderT < b.t, which
      // would otherwise dead-reckon *backwards* and pop the ship on spawn.
      const over = THREE.MathUtils.clamp((renderT - b.t) / 1000, 0, 0.25);
      x = b.x + Math.sin(b.h) * b.s * over;
      y = b.y;
      z = b.z + Math.cos(b.h) * b.s * over;
      h = b.h; k = b.k; s = b.s;
    }
    if (!rec.placed) {
      // Snap to the first real position instead of sliding in from the origin.
      g.position.set(x, y, z);
      g.rotation.y = h;
      rec.placed = true;
      setPlaced(true);
    } else {
      // One more smoothing layer hides snapshot-boundary corners.
      g.position.x = THREE.MathUtils.damp(g.position.x, x, 18, delta);
      g.position.y = THREE.MathUtils.damp(g.position.y, y, 18, delta);
      g.position.z = THREE.MathUtils.damp(g.position.z, z, 18, delta);
      g.rotation.y += shortestAngle(g.rotation.y, h) * smooth(delta, 14);
    }
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, k, 12, delta);
    if (glow.current) glow.current.scale.setScalar(0.85 + Math.min(Math.abs(s) / 24, 1) * 0.9 + (b.b ? 0.45 : 0));
    rec.cur.set(g.position.x, g.position.y, g.position.z);
    rec.speed = s;
    rec.heading = h;
  });
  return (
    <group ref={group}>
      {placed && (
        <>
          <RaceShipMesh hue={rec.hue} glowRef={glow} trailLength={5} lit={!lowPerf} />
          <Html center distanceFactor={26} position={[0, 1.5, 0]} zIndexRange={[30, 0]}>
            <div className="race-nametag" style={{ '--pilot': `hsl(${rec.hue} 85% 65%)` }}>
              <span className="race-nametag__dot" />
              {rec.name}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

function RemoteFleet({ playersRef, fleetVersion, netRef, lowPerf }) {
  // fleetVersion bumps when membership changes; positions flow through refs.
  void fleetVersion;
  const recs = [...playersRef.current.values()];
  return (
    <group>
      {recs.map((rec) => <RemoteShip key={rec.id} rec={rec} netRef={netRef} lowPerf={lowPerf} />)}
    </group>
  );
}

/* ------------------------------------------------------------- speed lines */
function SpeedStreaks({ telemetryRef, count = 90 }) {
  const { camera } = useThree();
  const group = useRef();
  const geo = useRef();
  const matRef = useRef();
  const seeds = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.8 + Math.random() * 6;
      arr.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, z: Math.random() });
    }
    return arr;
  }, [count]);
  const positions = useMemo(() => new Float32Array(count * 2 * 3), [count]);
  useFrame((st, delta) => {
    const tl = telemetryRef.current;
    const target = Math.max(0, tl.speed01 - 0.45) * 1.1 + (tl.boost ? 0.35 : 0);
    const p = THREE.MathUtils.damp(matRef.current?.opacity ?? 0, Math.min(target, 0.8), 5, delta);
    if (matRef.current) matRef.current.opacity = p;
    if (group.current) {
      group.current.position.copy(camera.position);
      group.current.quaternion.copy(camera.quaternion);
      group.current.visible = p > 0.02;
    }
    if (p <= 0.02) return;
    const DEPTH = 50;
    const scroll = (st.clock.elapsedTime * (20 + p * 130)) % DEPTH;
    const len = 0.4 + p * 9;
    for (let i = 0; i < count; i++) {
      const d = seeds[i];
      const z = (d.z * DEPTH + scroll) % DEPTH;
      const o = i * 6;
      positions[o] = d.x; positions[o + 1] = d.y; positions[o + 2] = -z;
      positions[o + 3] = d.x; positions[o + 4] = d.y; positions[o + 5] = -(z + len);
    }
    if (geo.current?.attributes.position) geo.current.attributes.position.needsUpdate = true;
  });
  return (
    <group ref={group} visible={false}>
      <lineSegments>
        <bufferGeometry ref={geo}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial ref={matRef} color="#ffffff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} />
      </lineSegments>
    </group>
  );
}

/* -------------------------------------------------------------- backdrop */
function nebulaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function ArenaBackdrop({ lowPerf }) {
  // Two star tiers: a sparse layer of bright near stars and a dense field of
  // faint far stars, so the sky reads with real depth instead of one flat sheet.
  const makeStars = (n, rMin, rSpread) => {
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = rMin + Math.random() * rSpread;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  };
  const farStars = useMemo(() => makeStars(lowPerf ? 900 : 2400, 360, 420), [lowPerf]);
  const nearStars = useMemo(() => makeStars(lowPerf ? 160 : 380, 220, 200), [lowPerf]);
  const tex = useMemo(() => nebulaTexture(), []);
  const clouds = useMemo(() => ([
    { p: [-260, 90, -340], s: 460, o: 0.09 },
    { p: [300, -40, -260], s: 400, o: 0.07 },
    { p: [80, 160, 380], s: 500, o: 0.06 },
    { p: [-340, -90, 220], s: 360, o: 0.055 },
    { p: [180, 120, -300], s: 300, o: 0.05 },
    { p: [-120, -140, -360], s: 340, o: 0.045 },
  ]), []);
  return (
    <group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[farStars, 3]} />
        </bufferGeometry>
        <pointsMaterial size={1.3} color="#ffffff" sizeAttenuation transparent opacity={0.72} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nearStars, 3]} />
        </bufferGeometry>
        <pointsMaterial size={2.6} color="#ffffff" sizeAttenuation transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      {clouds.map((cl, i) => (
        <sprite key={i} position={cl.p} scale={[cl.s, cl.s, 1]}>
          <spriteMaterial map={tex} transparent opacity={cl.o} blending={THREE.AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
      {/* a silent, distant ringed giant watching the race */}
      <group position={[240, -60, -420]} rotation={[0.4, 0, 0.25]}>
        <mesh>
          <sphereGeometry args={[60, 48, 48]} />
          <meshStandardMaterial color="#171a1f" metalness={0.5} roughness={0.6} emissive="#0b0d10" />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[92, 2.4, 2, 140]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.1} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/* ----------------------------------------------------------- spectator cam */
function SpectatorRig({ playersRef }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 10, 0));
  // LocalPilot stretches fov with speed and never gets a chance to undo it
  // when we take over mid-session — reset to the arena default or the orbit
  // renders with a stuck boost-fisheye.
  useEffect(() => {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }, [camera]);
  useFrame((st, delta) => {
    const t = st.clock.elapsedTime * 0.07;
    camera.position.lerp(
      new THREE.Vector3(Math.sin(t) * 150, 70 + Math.sin(t * 0.7) * 12, Math.cos(t) * 150),
      smooth(delta, 1.6)
    );
    // Watch the pack: average the ships that have real positions. Recs that
    // have never received a snapshot sit at the (0,-999,0) sentinel — averaging
    // those in would drag the look-target far below the arena.
    let n = 0;
    const target = new THREE.Vector3();
    for (const r of playersRef.current.values()) {
      if (r.placed && r.cur.y > -100) { target.add(r.cur); n++; }
    }
    if (n) target.divideScalar(n);
    else target.set(0, 10, 0);
    look.current.lerp(target, smooth(delta, 2));
    camera.lookAt(look.current);
  });
  return null;
}

/* -------------------------------------------------------------- the pilot */
function LocalPilot({
  phase, startAt, gridIndex, hue, lowPerf, control, playersRef, obstacles,
  shipStateRef, telemetryRef, gateStateRef, padFxRef, fxRef, netRef,
  onGate, onFinish,
}) {
  const { camera } = useThree();
  const track = getTrack();
  const ship = useRef();
  const glow = useRef();
  const keys = useRef({});
  const d = useRef({
    pos: new THREE.Vector3(), heading: 0, speed: 0, bank: 0, y: 0,
    energy: 1, lap: 0, next: 1, passed: 0, finished: false,
    hint: 0, wrongT: 0, invuln: 0, shake: 0, bumpCd: 0, obsCd: 0,
    lastCount: 99, launched: false, respawnGate: 0,
    lapStart: 0, lastLapMs: 0, bestLapMs: 0, offT: 0,
  }).current;

  // Personal best lap survives across sessions.
  useEffect(() => {
    try { d.bestLapMs = parseInt(localStorage.getItem('teamos_best_lap') || '0', 10) || 0; } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fwd = useRef(new THREE.Vector3());
  const desiredCam = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  const scratch = useRef(new THREE.Vector3());

  // Keyboard — same bindings as the hub, plus R to respawn.
  useEffect(() => {
    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e) => {
      if (!e.key || typing(e)) return; // editing the callsign must not steer the ship
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      keys.current[k] = true;
    };
    const up = (e) => { if (e.key && !typing(e)) keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const respawn = (gateIdx) => {
    const g = track.gates[gateIdx];
    d.pos.copy(g.pos).addScaledVector(g.tan, -4);
    d.y = d.pos.y;
    d.heading = Math.atan2(g.tan.x, g.tan.z);
    d.speed = 0;
    d.invuln = 1.6;
  };

  // Phase transitions: lock onto the grid at launch, reset progress counters.
  useEffect(() => {
    if (phase === 'racing') {
      const slot = gridSlot(Math.max(gridIndex, 0));
      d.pos.copy(slot.pos);
      d.y = slot.pos.y;
      d.heading = slot.heading;
      d.speed = 0;
      d.bank = 0;
      d.lap = 0;
      d.next = 1;
      d.passed = 0;
      d.finished = false;
      d.launched = false;
      d.energy = 1;
      d.respawnGate = 0;
      d.hint = nearestSample(d.pos, 0);
      gateStateRef.current = { next: 1, finished: false };
    } else if (phase === 'lobby' || phase === 'armed') {
      // free practice around the start straight
      gateStateRef.current = { next: -1, finished: false };
      d.finished = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Spawn on the practice apron the first time the arena loads.
  useEffect(() => {
    const slot = gridSlot(0);
    d.pos.copy(slot.pos).add(new THREE.Vector3(0, 0, 0));
    d.y = slot.pos.y;
    d.heading = slot.heading;
    d.hint = nearestSample(d.pos, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((st, delta) => {
    // Clamp integration to 0.1s: guards against huge post-stall steps while
    // keeping the sim real-time down to 10 FPS. (A 0.05 clamp made sub-20-FPS
    // machines race in slow motion vs. the wall-clock standings — unfair.)
    const dt = Math.min(delta, 0.1);
    const k = keys.current;
    const serverNow = netRef.current?.serverNow() ?? Date.now();
    const preLaunch = phase === 'racing' && startAt && serverNow < startAt;
    const racing = phase === 'racing' && !preLaunch && !d.finished;

    /* countdown ticks + GO */
    if (phase === 'racing' && startAt) {
      const remain = Math.max(0, startAt - serverNow);
      const count = Math.ceil(remain / 1000);
      if (count !== d.lastCount) {
        if (count > 0 && count <= 3) audio.count();
        d.lastCount = count;
      }
      if (!d.launched && remain <= 0) {
        d.launched = true;
        d.lapStart = performance.now();
        audio.go();
      }
    }

    /* ---- drive model ---- */
    let thrust = 0, turn = 0, boosting = false;
    const allowControl = !preLaunch && !d.finished && phase !== 'results';
    if (allowControl) {
      const c = control?.current || { thrust: 0, turn: 0, boost: false };
      thrust = THREE.MathUtils.clamp((k['arrowup'] || k['w'] ? 1 : 0) - (k['arrowdown'] || k['s'] ? 1 : 0) + c.thrust, -1, 1);
      turn = THREE.MathUtils.clamp((k['arrowleft'] || k['a'] ? 1 : 0) - (k['arrowright'] || k['d'] ? 1 : 0) + c.turn, -1, 1);
      const wantBoost = !!(k['shift'] || c.boost);
      boosting = wantBoost && thrust > 0.2 && d.energy > 0.04;
    }

    // Slipstream: tucked in close behind a rival's wake = extra top speed.
    let slip = false;
    fwd.current.set(Math.sin(d.heading), 0, Math.cos(d.heading));
    if (racing) {
      for (const rec of playersRef.current.values()) {
        if (!rec.placed || rec.cur.y < -100) continue; // no live position yet
        scratch.current.copy(rec.cur).sub(d.pos);
        const dist = scratch.current.length();
        if (dist > 1.6 && dist < 10 && rec.speed > 9) {
          scratch.current.normalize();
          if (scratch.current.dot(fwd.current) > 0.93) { slip = true; break; }
        }
      }
    }

    // Boost cell: drains under boost, trickles back — faster in a slipstream.
    if (boosting) d.energy = Math.max(0, d.energy - 0.32 * dt);
    else d.energy = Math.min(1, d.energy + (slip ? 0.22 : 0.09) * dt);

    const offTrack = (() => {
      d.hint = nearestSample(d.pos, d.hint);
      const s = track.samples[d.hint];
      return scratch.current.copy(d.pos).sub(s.p).setY(0).length() > CORRIDOR;
    })();

    const maxSpd = (boosting ? 41 : 28) + (slip ? 6 : 0);
    const accel = boosting ? 62 : 38;
    d.heading += turn * (2.15 - Math.min(Math.abs(d.speed) / 60, 0.55)) * dt;
    d.speed += thrust * accel * dt;
    d.speed *= 1 - (offTrack ? 3.4 : 1.15) * dt;
    d.speed = THREE.MathUtils.clamp(d.speed, -8, offTrack ? maxSpd * 0.55 : maxSpd);
    fwd.current.set(Math.sin(d.heading), 0, Math.cos(d.heading));
    d.pos.addScaledVector(fwd.current, d.speed * dt);

    // Altitude rides the track's elevation profile — 2D controls, 3D circuit.
    const sample = track.samples[d.hint];
    d.y = THREE.MathUtils.damp(d.y, sample.p.y + 0.4, 5, dt);
    d.pos.y = d.y;

    // In the lobby, keep pilots near the start straight so the grid stays social.
    if (phase !== 'racing') {
      const anchor = track.start.pos;
      const dist = Math.hypot(d.pos.x - anchor.x, d.pos.z - anchor.z);
      if (dist > 85) {
        const pull = (dist - 85) / dist;
        d.pos.x -= (d.pos.x - anchor.x) * pull;
        d.pos.z -= (d.pos.z - anchor.z) * pull;
        d.speed *= 0.6;
      }
    }

    const bankTarget = -turn * 0.42 * THREE.MathUtils.clamp(Math.abs(d.speed) / 7, 0, 1);
    d.bank = THREE.MathUtils.damp(d.bank, bankTarget, 6, dt);
    d.invuln = Math.max(0, d.invuln - dt);
    d.bumpCd = Math.max(0, d.bumpCd - dt);
    d.obsCd = Math.max(0, d.obsCd - dt);

    /* ---- obstacle collisions ---- */
    if (d.invuln <= 0 && d.obsCd <= 0 && Math.abs(d.speed) > 2) {
      for (const o of obstacles) {
        const dx = d.pos.x - o.pos.x, dy = d.pos.y - o.pos.y, dz = d.pos.z - o.pos.z;
        const rr = o.r + 0.85;
        if (dx * dx + dy * dy + dz * dz < rr * rr) {
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          d.pos.x += (dx / dist) * (rr - dist + 0.05);
          d.pos.z += (dz / dist) * (rr - dist + 0.05);
          d.speed *= 0.38;
          d.obsCd = 0.7;
          d.shake = Math.min(d.shake + 0.5, 1);
          fxRef.current = [...fxRef.current, { key: `o${st.clock.elapsedTime}`, pos: [o.pos.x, o.pos.y, o.pos.z], born: st.clock.elapsedTime }];
          audio.clank();
          break;
        }
      }
    }

    /* ---- ship-to-ship contact ---- */
    if (d.bumpCd <= 0) {
      for (const rec of playersRef.current.values()) {
        if (!rec.placed || rec.cur.y < -100) continue; // skip ships with no live position yet
        const dx = d.pos.x - rec.cur.x, dy = d.pos.y - rec.cur.y, dz = d.pos.z - rec.cur.z;
        if (dx * dx + dy * dy + dz * dz < 1.5 * 1.5) {
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          d.pos.x += (dx / dist) * (1.5 - dist) * 0.85;
          d.pos.z += (dz / dist) * (1.5 - dist) * 0.85;
          d.speed *= 0.74;
          d.bumpCd = 0.5;
          d.shake = Math.min(d.shake + 0.35, 1);
          fxRef.current = [...fxRef.current, {
            key: `b${st.clock.elapsedTime}`,
            pos: [(d.pos.x + rec.cur.x) / 2, (d.pos.y + rec.cur.y) / 2, (d.pos.z + rec.cur.z) / 2],
            born: st.clock.elapsedTime,
          }];
          audio.clank();
          break;
        }
      }
    }

    /* ---- boost pads ---- */
    for (const pad of track.pads) {
      const dx = d.pos.x - pad.pos.x, dz = d.pos.z - pad.pos.z;
      if (dx * dx + dz * dz < 3.1 * 3.1 && Math.abs(d.pos.y - pad.pos.y) < 3) {
        const t = st.clock.elapsedTime;
        if (!padFxRef.current[pad.idx] || t - padFxRef.current[pad.idx] > 1.2) {
          padFxRef.current[pad.idx] = t;
          d.energy = 1;
          d.speed = Math.min(d.speed + 5, 46);
          audio.pad();
        }
      }
    }

    /* ---- gates + laps + finish ---- */
    let frac = 0;
    if (racing) {
      const gate = track.gates[d.next];
      const dist = d.pos.distanceTo(gate.pos);
      const prev = track.gates[(d.next + GATE_COUNT - 1) % GATE_COUNT];
      const seg = prev.pos.distanceTo(gate.pos) || 1;
      frac = THREE.MathUtils.clamp(1 - dist / seg, 0, 0.999);
      if (dist < GATE_RADIUS) {
        d.passed += 1;
        // We're AT the new segment's start now — reset the fraction, or prog
        // momentarily reads ~a full gate ahead (passed+1 plus the old ~1.0
        // frac) and the standings jitter at every crossing.
        frac = 0;
        d.respawnGate = d.next;
        const crossedLine = d.next === 0;
        d.next = (d.next + 1) % GATE_COUNT;
        gateStateRef.current = { next: d.next, finished: false };
        if (crossedLine) {
          // lap clock: record the lap, chase the personal best
          const lapMs = d.lapStart ? Math.round(performance.now() - d.lapStart) : 0;
          if (lapMs > 3000) {
            d.lastLapMs = lapMs;
            if (!d.bestLapMs || lapMs < d.bestLapMs) {
              d.bestLapMs = lapMs;
              try { localStorage.setItem('teamos_best_lap', String(lapMs)); } catch {}
            }
          }
          d.lapStart = performance.now();
          d.lap += 1;
          if (d.lap >= LAPS) {
            d.finished = true;
            gateStateRef.current = { next: -1, finished: true };
            onFinish?.();
          } else if (d.lap === LAPS - 1) {
            audio.bell(); // final lap
          }
        }
        if (!d.finished) audio.gate();
        onGate?.(d.passed + frac, d.lap, d.next);
      }

      // wrong-way detection
      const along = fwd.current.dot(sample.tan);
      if (along < -0.35 && Math.abs(d.speed) > 6) d.wrongT += dt;
      else d.wrongT = 0;

      // Respawn: press R for an instant reset, OR get auto-placed back on the
      // track after being stranded outside the rails too long. The auto path is
      // what gives touch pilots (no keyboard) the advertised recovery.
      d.offT = offTrack ? d.offT + dt : 0;
      if (k['r'] || d.offT > 3.5) {
        respawn(d.respawnGate);
        k['r'] = false;
        d.offT = 0;
      }
    }

    /* ---- finished autopilot: cruise the circuit while the podium settles */
    if (d.finished || (phase === 'results' && !d.finished)) {
      const tgt = track.samples[(d.hint + 14) % track.samples.length];
      scratch.current.copy(tgt.p).sub(d.pos);
      const want = Math.atan2(scratch.current.x, scratch.current.z);
      d.heading += shortestAngle(d.heading, want) * smooth(dt, 2.5);
      d.speed = THREE.MathUtils.damp(d.speed, 13, 1.5, dt);
      fwd.current.set(Math.sin(d.heading), 0, Math.cos(d.heading));
    }

    /* ---- write the ship + shared state ---- */
    if (ship.current) {
      ship.current.position.set(d.pos.x, d.pos.y + Math.sin(st.clock.elapsedTime * 1.7) * 0.06, d.pos.z);
      ship.current.rotation.y = d.heading;
      ship.current.rotation.z = d.bank;
    }
    if (glow.current) {
      const f = Math.min(Math.abs(d.speed) / 26, 1) + (boosting ? 0.5 : 0);
      glow.current.scale.setScalar(0.85 + f * 0.95);
    }
    audio.engineSet(Math.abs(d.speed) / 26, boosting);

    // Wrap heading into (-π, π] before transmitting. d.heading accumulates
    // unbounded (a closed lap adds a net ±2π winding), so the raw value would
    // otherwise blow past the server's relay range and freeze rivals' yaw.
    shipStateRef.current = {
      x: d.pos.x, y: d.pos.y, z: d.pos.z,
      h: Math.atan2(Math.sin(d.heading), Math.cos(d.heading)), k: d.bank,
      s: d.speed, b: boosting,
      prog: racing || d.finished ? d.passed + frac : 0,
      lap: d.lap,
    };
    const tl = telemetryRef.current;
    tl.speed01 = Math.min(Math.abs(d.speed) / 41, 1);
    tl.energy = d.energy;
    tl.boost = boosting;
    tl.slip = slip;
    tl.off = offTrack && racing;
    tl.wrong = d.wrongT > 1.1;
    tl.lap = Math.min(d.lap + 1, LAPS);
    tl.gate = d.next;
    tl.passed = d.passed;
    tl.finished = d.finished;
    tl.lapStartPerf = racing && d.launched ? d.lapStart : 0;
    tl.lastLapMs = d.lastLapMs;
    tl.bestLapMs = d.bestLapMs;

    /* ---- camera ---- */
    d.shake = Math.max(0, d.shake - dt * 2.2);
    const speedFov = 55 + tl.speed01 * 16 + (boosting ? 7 : 0);
    camera.fov = THREE.MathUtils.damp(camera.fov, speedFov, 5, dt);
    camera.updateProjectionMatrix();

    if (preLaunch && startAt) {
      // cinematic sweep: glide from a side reveal into the chase slot as GO nears
      const t01 = THREE.MathUtils.clamp((startAt - serverNow) / 4200, 0, 1);
      const orbit = d.heading + Math.PI * 0.5 * t01 + Math.PI;
      desiredCam.current.set(
        d.pos.x + Math.sin(orbit) * (7.5 + t01 * 3),
        d.pos.y + 2.2 + t01 * 1.4,
        d.pos.z + Math.cos(orbit) * (7.5 + t01 * 3)
      );
      camera.position.lerp(desiredCam.current, smooth(dt, 4));
      lookAt.current.lerp(scratch.current.copy(d.pos).setY(d.pos.y + 0.8), smooth(dt, 6));
      camera.lookAt(lookAt.current);
      return;
    }

    desiredCam.current.copy(d.pos).addScaledVector(fwd.current, -7.6);
    desiredCam.current.y = d.pos.y + 2.7;
    camera.position.lerp(desiredCam.current, smooth(dt, 4.2));
    if (d.shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * d.shake * 0.4;
      camera.position.y += (Math.random() - 0.5) * d.shake * 0.3;
    }
    scratch.current.copy(d.pos).addScaledVector(fwd.current, 4.5);
    scratch.current.y = d.pos.y + 1.1;
    lookAt.current.lerp(scratch.current, smooth(dt, 5));
    camera.lookAt(lookAt.current);
  });

  return (
    <group ref={ship}>
      <RaceShipMesh hue={hue} glowRef={glow} />
    </group>
  );
}

/* ---------------------------------------------------------------- effects */
function RaceEffects({ telemetryRef }) {
  // Built imperatively (not via the <ChromaticAberration> wrapper): with React
  // 19, passing a ref through that wrapper trips its JSON.stringify memo key
  // on a circular object. A <primitive> effect sidesteps it and lets us mutate
  // the offset per frame for boost-reactive fringing.
  const chroma = useMemo(
    () => new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0004, 0.0002), radialModulation: false, modulationOffset: 0 }),
    []
  );
  useFrame((_, delta) => {
    const tl = telemetryRef.current;
    const target = 0.0004 + (tl.boost ? 0.0024 : 0) + tl.speed01 * 0.0008;
    chroma.offset.x = THREE.MathUtils.damp(chroma.offset.x, target, 4, delta);
    chroma.offset.y = THREE.MathUtils.damp(chroma.offset.y, target * 0.6, 4, delta);
  });
  return (
    // MSAA 2 not 4: bloom's mipmap blur already eats most edge shimmer, and
    // halving the composer's sample count buys real frame time on mid GPUs.
    <EffectComposer multisampling={2}>
      <Bloom intensity={1.35} luminanceThreshold={0.18} luminanceSmoothing={0.32} mipmapBlur radius={0.88} />
      <primitive object={chroma} />
      <Vignette offset={0.28} darkness={0.92} />
    </EffectComposer>
  );
}

/* ------------------------------------------------------------------ scene */
export default function RaceScene({
  phase, startAt, seed, gridIndex, spectating, lowPerf, control,
  playersRef, fleetVersion, shipStateRef, telemetryRef, netRef,
  selfHue, onGate, onFinish,
}) {
  // Every client must generate the SAME field from the seed — obstacle count is
  // part of the shared-track contract (a lowPerf rival with fewer rocks would
  // fly through asteroids everyone else has to dodge). lowPerf economizes on
  // rendering (instanced, 2 draw calls) — never on the layout.
  const obstacles = useMemo(() => genObstacles(seed || 1, 54), [seed]);
  const gateStateRef = useRef({ next: -1, finished: false });
  const padFxRef = useRef({});
  const fxRef = useRef([]);

  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 60, 260]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 22, 8]} intensity={0.9} />

      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 10, -14]} scale={[20, 10, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.2} position={[-14, 5, 8]} scale={[3, 16, 1]} color="#cfcfcf" />
        <Lightformer form="rect" intensity={1.2} position={[14, 5, 8]} scale={[3, 16, 1]} color="#cfcfcf" />
      </Environment>

      <ArenaBackdrop lowPerf={lowPerf} />
      {/* a faint tech grid far below the floating circuit — reads as depth,
          the same monochrome plane language as the hub */}
      {!lowPerf && (
        <Grid
          position={[0, -16, 0]}
          args={[600, 600]}
          cellSize={6}
          cellThickness={0.5}
          cellColor="#1c1c1c"
          sectionSize={36}
          sectionThickness={1}
          sectionColor="#3a3a3a"
          fadeDistance={340}
          fadeStrength={2.5}
          infiniteGrid
        />
      )}
      <TrackRibbon />
      <PulseRunners count={lowPerf ? 6 : 12} />
      <StartArch />
      {getTrack().gates.map((g) => (
        <Gate key={g.idx} data={g} gateStateRef={gateStateRef} />
      ))}
      <BoostPads padFxRef={padFxRef} />
      <ObstacleField obstacles={obstacles} />
      <ImpactBursts fxRef={fxRef} />
      <RemoteFleet playersRef={playersRef} fleetVersion={fleetVersion} netRef={netRef} lowPerf={lowPerf} />

      {spectating ? (
        <SpectatorRig playersRef={playersRef} />
      ) : (
        <LocalPilot
          phase={phase} startAt={startAt} gridIndex={gridIndex} hue={selfHue} lowPerf={lowPerf}
          control={control} playersRef={playersRef} obstacles={obstacles}
          shipStateRef={shipStateRef} telemetryRef={telemetryRef}
          gateStateRef={gateStateRef} padFxRef={padFxRef} fxRef={fxRef} netRef={netRef}
          onGate={onGate} onFinish={onFinish}
        />
      )}

      {!spectating && <SpeedStreaks telemetryRef={telemetryRef} count={lowPerf ? 40 : 90} />}
      {!lowPerf && <RaceEffects telemetryRef={telemetryRef} />}
    </>
  );
}
