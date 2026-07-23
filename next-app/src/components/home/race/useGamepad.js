'use client';

// Gamepad support for the Grand Prix: standard-mapping pads drive the same
// control ref the touch joystick uses (the scene merges it with keyboard).
//   left stick X / d-pad  → steer      right trigger (RT) → thrust
//   left trigger (LT)     → brake      A or RB            → boost
//   Y / triangle          → respawn (synthesized 'r' keypress)
// The pad only *writes* while it has meaningful input, so it never fights the
// keyboard or joystick when idle.

import { useEffect } from 'react';

const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export function useGamepad(controlRef, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return undefined;
    let raf;
    let wasActive = false;
    let respawnHeld = false;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pad = [...(navigator.getGamepads() || [])].find((p) => p && p.connected && p.mapping === 'standard')
        || [...(navigator.getGamepads() || [])].find((p) => p && p.connected);
      if (!pad) { wasActive = false; return; }

      const stickX = dz(pad.axes[0] ?? 0);
      const dpadX = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const rt = pad.buttons[7]?.value ?? (pad.buttons[7]?.pressed ? 1 : 0);
      const lt = pad.buttons[6]?.value ?? (pad.buttons[6]?.pressed ? 1 : 0);
      const stickY = -dz(pad.axes[1] ?? 0); // fallback: push stick up to fly
      const thrust = Math.max(-1, Math.min(1, (rt - lt) || Math.max(0, stickY)));
      const turn = Math.max(-1, Math.min(1, -(stickX || dpadX)));
      const boost = !!(pad.buttons[0]?.pressed || pad.buttons[5]?.pressed);

      const active = Math.abs(thrust) > 0.02 || Math.abs(turn) > 0.02 || boost;
      if (active || wasActive) {
        // one trailing zero-write when input stops, releasing the controls
        controlRef.current.thrust = thrust;
        controlRef.current.turn = turn;
        controlRef.current.boost = boost;
      }
      wasActive = active;

      // Y (button 3) → respawn, delivered as the same 'r' key the sim reads.
      const respawn = !!pad.buttons[3]?.pressed;
      if (respawn && !respawnHeld) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'r' })), 60);
      }
      respawnHeld = respawn;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [controlRef, enabled]);
}
