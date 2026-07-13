'use client';

// The playable open world. You pilot a spaceship with the arrow keys (or WASD),
// hold Shift to boost; a chase camera follows it across a wide grid field past a
// liquid-chrome core (with accretion rings), drifting asteroids, and a distant
// ringed planet. Fly near a node to focus it, then Enter/Space (or click) to dock.
// Ship state is written to a shared ref each frame for the radar + sounds —
// pointer parallax likewise — so neither re-renders React.

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Float, Html, Grid, Trail, MeshDistortMaterial, useCursor } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { STATIONS, STATIONS_BY_ID, WORLD_RADIUS } from './stations';
import { audio } from './audio';

const smooth = (delta, rate = 3.2) => 1 - Math.exp(-rate * delta);

/* --------------------------------------------------------------- liquid core */
function LiquidCore({ pointer }) {
  const group = useRef();
  const core = useRef();
  const ringA = useRef();
  const ringB = useRef();
  useFrame((st, delta) => {
    if (group.current) group.current.position.y = 1.2 + Math.sin(st.clock.elapsedTime * 0.5) * 0.2;
    if (core.current) {
      core.current.rotation.y += delta * 0.14;
      core.current.rotation.x = THREE.MathUtils.damp(core.current.rotation.x, pointer.current.y * 0.3, 2.5, delta);
    }
    if (ringA.current) ringA.current.rotation.z += delta * 0.18;
    if (ringB.current) ringB.current.rotation.z -= delta * 0.1;
  });
  return (
    <group ref={group} position={[0, 1.2, 0]}>
      <mesh ref={core} scale={2.6}>
        <icosahedronGeometry args={[1, 12]} />
        <MeshDistortMaterial color="#d2d8e0" metalness={1} roughness={0.12} envMapIntensity={1.5} distort={0.34} speed={1.6} />
      </mesh>
      <mesh ref={ringA} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[4.4, 0.035, 16, 140]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.28} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 2.6, 0.4, 0]}>
        <torusGeometry args={[5.4, 0.02, 16, 140]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.14} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------ particle field */
function ParticleField({ count = 2400 }) {
  const ref = useRef();
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 16 + Math.random() * 64;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.5 + 6;
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);
  useFrame((st, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.01;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} color="#ffffff" sizeAttenuation transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ----------------------------------------------------- scattered asteroids */
function Asteroids({ count = 130, shipRef, selected }) {
  const group = useRef();
  const rocks = useMemo(() => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 48;
      out.push({
        p: [Math.sin(a) * r, -2 + Math.random() * 11, Math.cos(a) * r],
        s: 0.3 + Math.random() * 1.5,
        rot: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
        detail: Math.random() > 0.7 ? 1 : 0,
      });
    }
    return out;
  }, [count]);
  const near = useRef(new Array(count).fill(false));
  const cooldown = useRef(0);
  useFrame((st, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.004;
    cooldown.current -= delta;
    if (selected || !shipRef) return;
    const s = shipRef.current;
    if (Math.abs(s.speed) < 4) return; // only whoosh past at speed
    const theta = group.current ? group.current.rotation.y : 0;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let i = 0; i < rocks.length; i++) {
      const p = rocks[i].p;
      if (Math.abs(p[1]) > 3.5) { near.current[i] = false; continue; } // not on the ship's plane
      const wx = p[0] * cos + p[2] * sin;
      const wz = -p[0] * sin + p[2] * cos;
      const isNear = Math.hypot(s.x - wx, s.z - wz) < 2.6 + rocks[i].s;
      if (isNear && !near.current[i] && cooldown.current <= 0) {
        audio.whoosh();
        cooldown.current = 0.22;
      }
      near.current[i] = isNear;
    }
  });
  // Two instanced meshes (one per detail level) instead of `count` separate
  // meshes — same look, ~2 draw calls instead of ~130.
  const split = useMemo(() => ({
    smooth: rocks.filter((r) => r.detail === 0),
    rough: rocks.filter((r) => r.detail === 1),
  }), [rocks]);
  return (
    <group ref={group}>
      <RockCluster rocks={split.smooth} detail={0} />
      <RockCluster rocks={split.rough} detail={1} />
    </group>
  );
}

function RockCluster({ rocks, detail }) {
  const inst = useRef();
  useLayoutEffect(() => {
    if (!inst.current) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    rocks.forEach((r, i) => {
      e.set(r.rot[0], r.rot[1], r.rot[2]);
      q.setFromEuler(e);
      p.set(r.p[0], r.p[1], r.p[2]);
      s.setScalar(r.s);
      m.compose(p, q, s);
      inst.current.setMatrixAt(i, m);
    });
    inst.current.instanceMatrix.needsUpdate = true;
  }, [rocks]);
  if (!rocks.length) return null;
  return (
    <instancedMesh ref={inst} args={[undefined, undefined, rocks.length]}>
      <icosahedronGeometry args={[1, detail]} />
      <meshStandardMaterial color="#8b9099" metalness={0.4} roughness={0.85} flatShading />
    </instancedMesh>
  );
}

/* ------------------------------------------------------- distant structures */
function Backdrop() {
  const a = useRef();
  const b = useRef();
  useFrame((st, delta) => {
    if (a.current) a.current.rotation.z += delta * 0.008;
    if (b.current) b.current.rotation.z -= delta * 0.005;
  });
  return (
    <group>
      <mesh ref={a} position={[-40, 20, -64]} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[16, 0.3, 16, 120]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.05} />
      </mesh>
      <mesh ref={b} position={[48, 16, -78]} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[22, 0.35, 16, 140]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.045} />
      </mesh>
      {/* distant ringed planet */}
      <group position={[58, -8, -96]} rotation={[0.5, 0, 0.3]}>
        <mesh>
          <sphereGeometry args={[18, 48, 48]} />
          <meshStandardMaterial color="#1a1d22" metalness={0.5} roughness={0.6} emissive="#0c0e11" />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[28, 0.8, 2, 140]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.12} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[33, 0.4, 2, 140]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.07} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------- spaceship */
function Spaceship({ shipRef }) {
  const glow = useRef();
  const light = useRef();
  useFrame(() => {
    const sp = shipRef ? Math.abs(shipRef.current.speed) : 0;
    const boost = shipRef ? shipRef.current.boost : false;
    const f = Math.min(sp / 20, 1) + (boost ? 0.45 : 0); // engine flares with speed + boost
    if (glow.current) glow.current.scale.setScalar(0.85 + f * 0.9);
    if (light.current) light.current.intensity = 5 + f * 9;
  });
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
        <boxGeometry args={[1.15, 0.05, 0.34]} />
        <meshStandardMaterial color="#cdd4dd" metalness={0.88} roughness={0.24} />
      </mesh>
      <mesh position={[0, 0.16, -0.42]}>
        <boxGeometry args={[0.05, 0.32, 0.3]} />
        <meshStandardMaterial color="#cdd4dd" metalness={0.88} roughness={0.24} />
      </mesh>
      <mesh position={[0, 0.12, 0.18]}>
        <sphereGeometry args={[0.16, 20, 20]} />
        <meshStandardMaterial color="#7f8893" metalness={1} roughness={0.05} envMapIntensity={1.5} />
      </mesh>
      <mesh ref={glow} position={[0, 0, -0.62]}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* engine trail */}
      <Trail width={2.4} length={7} color="#ffffff" attenuation={(t) => t * t} decay={1.4}>
        <mesh position={[0, 0, -0.7]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </Trail>
      <pointLight ref={light} position={[0, 0.1, -0.85]} color="#ffffff" intensity={7} distance={7} />
    </group>
  );
}

/* ----------------------------------------------------- player (ship + camera) */
function Player({ selected, warping, onSelect, onFocusChange, onBoost, pointer, control, shipRef }) {
  const { camera } = useThree();
  const ship = useRef();
  const drive = useRef({ heading: 0, speed: 0, bank: 0, pos: new THREE.Vector3(0, 0, -10) });
  const keys = useRef({});
  const focusedRef = useRef(null);
  const boostingRef = useRef(false);

  const fwd = useRef(new THREE.Vector3());
  const desiredCam = useRef(new THREE.Vector3(0, 3.9, -18));
  const lookAt = useRef(new THREE.Vector3(0, 1, 0));
  const scratch = useRef(new THREE.Vector3());

  useEffect(() => {
    const down = (e) => {
      if (!e.key) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (k === 'enter' || k === ' ') {
        if (!selected && focusedRef.current) onSelect(focusedRef.current);
        return;
      }
      if (k === 'escape') {
        if (selected) onSelect(null);
        return;
      }
      keys.current[k] = true;
    };
    const up = (e) => { if (e.key) keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [selected, onSelect]);

  useFrame((st, delta) => {
    const dt = Math.min(delta, 0.05);
    const d = drive.current;
    const k = keys.current;

    // hyperspace FOV punch during warp
    const targetFov = warping ? 82 : 50 + Math.min(Math.abs(d.speed), 32) * 0.5; // widen with speed (max speed 32)
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, warping ? 16 : 6, dt);
      camera.updateProjectionMatrix();
    }

    let boosting = false;
    if (!selected) {
      const c = control?.current || { thrust: 0, turn: 0, boost: false };
      const thrust = THREE.MathUtils.clamp((k['arrowup'] || k['w'] ? 1 : 0) - (k['arrowdown'] || k['s'] ? 1 : 0) + c.thrust, -1, 1);
      const turn = THREE.MathUtils.clamp((k['arrowleft'] || k['a'] ? 1 : 0) - (k['arrowright'] || k['d'] ? 1 : 0) + c.turn, -1, 1);
      boosting = !!((k['shift'] || c.boost) && thrust > 0.2);
      const accel = boosting ? 44 : 30;
      const maxSpd = boosting ? 32 : 20;
      d.heading += turn * 2.0 * dt;
      d.speed += thrust * accel * dt;
      d.speed *= 1 - 1.4 * dt; // drag
      d.speed = THREE.MathUtils.clamp(d.speed, -7, maxSpd);
      fwd.current.set(Math.sin(d.heading), 0, Math.cos(d.heading));
      d.pos.addScaledVector(fwd.current, d.speed * dt);
      const radial = Math.hypot(d.pos.x, d.pos.z);
      if (radial > WORLD_RADIUS) {
        d.pos.x *= WORLD_RADIUS / radial;
        d.pos.z *= WORLD_RADIUS / radial;
        d.speed *= 0.4;
      }
      const bankTarget = -turn * 0.4 * THREE.MathUtils.clamp(Math.abs(d.speed) / 6, 0, 1);
      d.bank = THREE.MathUtils.damp(d.bank, bankTarget, 6, dt);

      if (boosting && !boostingRef.current) onBoost?.();
      boostingRef.current = boosting;
    }

    if (shipRef) {
      shipRef.current.x = d.pos.x;
      shipRef.current.z = d.pos.z;
      shipRef.current.heading = d.heading;
      shipRef.current.speed = d.speed;
      shipRef.current.boost = boosting;
    }

    if (ship.current) {
      ship.current.position.set(d.pos.x, Math.sin(st.clock.elapsedTime * 1.6) * 0.1, d.pos.z);
      ship.current.rotation.y = d.heading;
      ship.current.rotation.z = d.bank;
    }

    // engine pitch tracks speed (idles while docked)
    audio.engineSet(selected ? 0 : Math.abs(d.speed) / 20, !selected && boosting);

    if (selected) {
      const t = STATIONS_BY_ID[selected];
      const rate = warping ? 5.5 : 2.4;
      desiredCam.current.set(t.cam[0], t.cam[1], t.cam[2]);
      camera.position.lerp(desiredCam.current, smooth(dt, rate));
      lookAt.current.lerp(scratch.current.set(t.look[0], t.look[1], t.look[2]), smooth(dt, rate));
      camera.lookAt(lookAt.current);
      return;
    }

    // chase camera
    fwd.current.set(Math.sin(d.heading), 0, Math.cos(d.heading));
    desiredCam.current.copy(d.pos).addScaledVector(fwd.current, -8);
    desiredCam.current.y = 3.9;
    desiredCam.current.x += pointer.current.x * 1.2;
    camera.position.lerp(desiredCam.current, smooth(dt, warping ? 6 : 3.2));
    scratch.current.copy(d.pos).addScaledVector(fwd.current, 3.2);
    scratch.current.y = 1.7; // aim higher so the core sits centered, not near the top
    lookAt.current.lerp(scratch.current, smooth(dt, 4.5));
    camera.lookAt(lookAt.current);

    // focus the nearest node within docking range
    let best = null;
    let bestD = Infinity;
    for (const s of STATIONS) {
      const dist = Math.hypot(d.pos.x - s.pos[0], d.pos.z - s.pos[2]);
      if (dist < bestD) { bestD = dist; best = s.id; }
    }
    const within = bestD < 5.5 ? best : null;
    if (within !== focusedRef.current) {
      focusedRef.current = within;
      onFocusChange(within);
    }
  });

  return (
    <group ref={ship}>
      <Spaceship shipRef={shipRef} />
    </group>
  );
}

/* ------------------------------------------------------------- station node */
function StationNode({ data, active, focused, dimmed, onSelect }) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const ref = useRef();
  const matRef = useRef();
  const lit = hovered || focused || active;

  useFrame((st, delta) => {
    const m = ref.current;
    if (!m) return;
    m.rotation.y += delta * 0.5;
    m.rotation.x += delta * 0.18;
    const target = active ? 1.3 : lit ? 1.18 : 1;
    m.scale.setScalar(THREE.MathUtils.damp(m.scale.x, target, 7, delta));
    if (matRef.current) {
      const glow = active ? 1.1 : lit ? 0.8 : 0.22;
      matRef.current.emissiveIntensity = THREE.MathUtils.damp(matRef.current.emissiveIntensity, glow, 7, delta);
    }
  });

  return (
    <group position={data.pos}>
      <mesh position={[0, 9, 0]}>
        <cylinderGeometry args={[0.05, 0.22, 22, 12, 1, true]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={lit ? 0.5 : 0.16} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.32, 0]}>
        <circleGeometry args={[3.2, 40]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={lit ? 0.14 : 0.05} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <Float speed={2.2} rotationIntensity={0.4} floatIntensity={0.8}>
        <mesh
          ref={ref}
          onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
          onPointerOut={() => setHovered(false)}
          onClick={(e) => { e.stopPropagation(); onSelect(data.id); }}
        >
          <icosahedronGeometry args={[0.8, 0]} />
          <meshStandardMaterial ref={matRef} color="#ffffff" metalness={0.85} roughness={0.15} emissive="#ffffff" emissiveIntensity={0.22} envMapIntensity={1} transparent opacity={dimmed ? 0.3 : 1} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.2, 0.018, 16, 90]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={dimmed ? 0.08 : lit ? 0.6 : 0.24} />
        </mesh>
        <Html center distanceFactor={18} position={[0, -1.7, 0]} zIndexRange={[20, 0]}>
          <button type="button" className={`hub-label${active || focused ? ' is-active' : ''}`} onClick={() => onSelect(data.id)} style={{ opacity: dimmed ? 0.3 : 1 }}>
            <span className="hub-label__title">{data.label}</span>
            <span className="hub-label__sub">{data.sub}</span>
          </button>
        </Html>
      </Float>
      <pointLight color="#ffffff" intensity={lit ? 7 : 2.5} distance={7} />
    </group>
  );
}

/* ----------------------------------------------------- collectible coins */
function Coin({ x, z, born }) {
  const ref = useRef();
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    m.rotation.y += 0.05;
    m.position.y = 0.7 + Math.sin(st.clock.elapsedTime * 2 + x) * 0.15;
    const pop = Math.min(1, (st.clock.elapsedTime - born) / 0.4); // scale-in pop
    m.scale.setScalar(pop);
  });
  return (
    <group ref={ref} position={[x, 0.7, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.07, 24]} />
        <meshStandardMaterial color="#ffffff" metalness={0.9} roughness={0.2} emissive="#ffffff" emissiveIntensity={0.6} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* No pointLight here on purpose: with up to 16 coins alive, per-coin
          lights ballooned the lighting cost of every material in the scene.
          The emissive disc + glow halo carry the look on their own. */}
    </group>
  );
}

// A quick expanding ring burst when a coin is collected. Geometry is shared
// across all pops (they're identical); only material opacity/scale vary.
const POP_GEO = new THREE.RingGeometry(0.5, 0.62, 32);
function Pop({ x, z, born }) {
  const ref = useRef();
  const mat = useRef();
  useFrame((st) => {
    const t = Math.min((st.clock.elapsedTime - born) / 0.5, 1);
    if (ref.current) ref.current.scale.setScalar(0.5 + t * 2.6);
    if (mat.current) mat.current.opacity = (1 - t) * 0.6;
  });
  return (
    <mesh ref={ref} position={[x, 0.7, z]} rotation={[Math.PI / 2, 0, 0]} geometry={POP_GEO}>
      <meshBasicMaterial ref={mat} color="#ffffff" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Coins scattered across the world that pop in one-by-one over time, capped at
// COIN_MAX alive — so the supply never runs dry. Fly through one to collect it.
const COIN_MAX = 16;
const COIN_COLLECT_R = 2.4;
function spawnCoin(id, born, minR = 9) {
  const a = Math.random() * Math.PI * 2;
  const r = minR + Math.random() * (WORLD_RADIUS - minR - 4); // out in the world, clear of the core
  return { key: `coin${id}`, x: Math.cos(a) * r, z: Math.sin(a) * r, born };
}
function Coins({ shipRef, selected, onCollect }) {
  // initial coins spawn well away from the ship's start so they aren't auto-collected
  const coinsRef = useRef(Array.from({ length: 6 }, (_, i) => spawnCoin(i, 0, 16)));
  const idRef = useRef(6);
  const timer = useRef(1.2);
  const popsRef = useRef([]);
  const [, force] = useReducer((x) => x + 1, 0);

  useFrame((st, delta) => {
    const s = shipRef.current;

    // retire collect-pops that have finished their burst
    if (popsRef.current.length && st.clock.elapsedTime - popsRef.current[0].born >= 0.55) {
      popsRef.current = popsRef.current.filter((p) => st.clock.elapsedTime - p.born < 0.55);
      force();
    }

    // spawn one coin at a time, up to the cap
    timer.current -= delta;
    if (timer.current <= 0 && coinsRef.current.length < COIN_MAX) {
      const coin = spawnCoin(idRef.current++, st.clock.elapsedTime);
      if (Math.hypot(s.x - coin.x, s.z - coin.z) > 6) { // don't pop right on the ship
        coinsRef.current = [...coinsRef.current, coin];
        force();
        timer.current = 0.8 + Math.random() * 1.8;
      } else {
        timer.current = 0.15; // rejected near the ship — retry shortly so the field refills
      }
    }

    // collect coins the ship flies through (not while docked). Cheap first pass
    // so we only allocate the filtered array on the rare frame something's hit.
    if (!selected) {
      let hit = false;
      for (const c of coinsRef.current) {
        if (Math.hypot(s.x - c.x, s.z - c.z) < COIN_COLLECT_R) { hit = true; break; }
      }
      if (hit) {
        let collected = 0;
        const remaining = [];
        const pops = [];
        for (const c of coinsRef.current) {
          if (Math.hypot(s.x - c.x, s.z - c.z) < COIN_COLLECT_R) {
            collected++;
            pops.push({ key: `pop${c.key}-${st.clock.elapsedTime}`, x: c.x, z: c.z, born: st.clock.elapsedTime });
          } else remaining.push(c);
        }
        coinsRef.current = remaining;
        popsRef.current = [...popsRef.current, ...pops];
        force();
        onCollect(collected);
      }
    }
  });

  return (
    <group>
      {coinsRef.current.map((c) => (
        <Coin key={c.key} x={c.x} z={c.z} born={c.born} />
      ))}
      {popsRef.current.map((p) => (
        <Pop key={p.key} x={p.x} z={p.z} born={p.born} />
      ))}
    </group>
  );
}

/* ----------------------------------------------------- 3D warp streaks */
// Line streaks parented to the camera that scroll forward and stretch during a
// warp — the in-canvas hyperspace tunnel behind the CSS flash.
function WarpStreaks({ warping, count = 150 }) {
  const { camera } = useThree();
  const group = useRef();
  const geo = useRef();
  const matRef = useRef();
  const progress = useRef(0);
  const seeds = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.4 + Math.random() * 7;
      arr.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, z: Math.random() });
    }
    return arr;
  }, [count]);
  const positions = useMemo(() => new Float32Array(count * 2 * 3), [count]);

  useFrame((st, delta) => {
    progress.current = THREE.MathUtils.damp(progress.current, warping ? 1 : 0, 7, delta);
    const p = progress.current;
    if (matRef.current) matRef.current.opacity = p * 0.9;
    if (group.current) {
      group.current.position.copy(camera.position);
      group.current.quaternion.copy(camera.quaternion);
      group.current.visible = p > 0.01;
    }
    if (p <= 0.01) return;
    const DEPTH = 70;
    const scroll = (st.clock.elapsedTime * (30 + p * 160)) % DEPTH;
    const len = 0.6 + p * 16;
    for (let i = 0; i < count; i++) {
      const d = seeds[i];
      const z = (d.z * DEPTH + scroll) % DEPTH;
      const o = i * 6;
      positions[o] = d.x; positions[o + 1] = d.y; positions[o + 2] = -z;
      positions[o + 3] = d.x; positions[o + 4] = d.y; positions[o + 5] = -(z + len);
    }
    if (geo.current && geo.current.attributes.position) geo.current.attributes.position.needsUpdate = true;
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

/* ----------------------------------------------------- compass tracker */
// Projects the nearest station to screen space each frame and writes a bearing
// into compassRef for the DOM compass arrow (shown only when it's off-screen).
function CompassTracker({ shipRef, selected, compassRef }) {
  const { camera } = useThree();
  const v = useRef(new THREE.Vector3());
  useFrame(() => {
    if (!compassRef) return;
    if (selected) { compassRef.current.hidden = true; return; }
    const s = shipRef.current;
    let best = null;
    let bd = Infinity;
    for (const n of STATIONS) {
      const d = Math.hypot(s.x - n.pos[0], s.z - n.pos[2]);
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) { compassRef.current.hidden = true; return; }
    v.current.set(best.pos[0], 1, best.pos[2]).project(camera);
    const behind = v.current.z > 1;
    let sx = v.current.x;
    let sy = v.current.y;
    if (behind) { sx = -sx; sy = -sy; }
    const onScreen = !behind && Math.abs(v.current.x) <= 0.9 && Math.abs(v.current.y) <= 0.9;
    compassRef.current.angle = Math.atan2(sx, sy);
    compassRef.current.name = best.label;
    compassRef.current.dist = Math.round(bd);
    compassRef.current.hidden = onScreen;
  });
  return null;
}

/* ------------------------------------------------------------------- scene */
export default function HubScene({ selected, focused, warping, lowPerf, onSelect, onFocusChange, onBoost, onCollect, pointer, control, shipRef, compassRef }) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 36, 120]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 14, 10]} intensity={1.1} />

      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 7, -12]} scale={[18, 10, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.3} position={[-12, 4, 6]} scale={[3, 14, 1]} color="#cfcfcf" />
        <Lightformer form="rect" intensity={1.3} position={[12, 4, 6]} scale={[3, 14, 1]} color="#cfcfcf" />
        <Lightformer form="ring" intensity={1.6} position={[0, 2, 12]} scale={8} color="#ffffff" />
      </Environment>

      <Grid
        position={[0, -1.35, 0]}
        args={[200, 200]}
        cellSize={1.6}
        cellThickness={0.6}
        cellColor="#222222"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#484848"
        fadeDistance={130}
        fadeStrength={2}
        infiniteGrid
      />

      <Backdrop />
      <Asteroids count={lowPerf ? 50 : 130} shipRef={shipRef} selected={selected} />
      <ParticleField count={lowPerf ? 1000 : 2600} />
      <LiquidCore pointer={pointer} />

      {STATIONS.map((s) => (
        <StationNode
          key={s.id}
          data={s}
          active={selected === s.id}
          focused={!selected && focused === s.id}
          dimmed={Boolean(selected) && selected !== s.id}
          onSelect={onSelect}
        />
      ))}

      <Coins shipRef={shipRef} selected={selected} onCollect={onCollect} />
      <CompassTracker shipRef={shipRef} selected={selected} compassRef={compassRef} />
      <WarpStreaks warping={warping} />

      <Player selected={selected} warping={warping} onSelect={onSelect} onFocusChange={onFocusChange} onBoost={onBoost} pointer={pointer} control={control} shipRef={shipRef} />

      {!lowPerf && (
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.3} mipmapBlur radius={0.78} />
          <Vignette offset={0.3} darkness={0.86} />
        </EffectComposer>
      )}
    </>
  );
}
