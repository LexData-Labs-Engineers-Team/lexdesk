'use client';

// Offline practice arena: the SAME engine the multiplayer relay runs, executed
// right here in the page, exposed through a RaceNet-compatible facade. When no
// relay is reachable (serverless hosting, teammate's box down, airplane mode)
// the pilot still gets a full grid — five AI rivals, real lifecycle, podium and
// all — with zero network. RaceExperience swaps this in for RaceNet and the
// rest of the client can't tell the difference.
//
// Messages cross the "wire" as JSON round-trips on a microtask: cloning keeps
// engine state and React state from sharing mutable objects, and the async hop
// preserves the ordering guarantees real sockets give (no handler re-entrancy).

import { createRaceEngine } from './raceEngine.mjs';

const PRACTICE_BOTS = 6; // solo pilot + 5 AI rivals on the grid

export function createLocalNet() {
  const handlers = new Map(); // type -> Set<fn>
  let engine = null;
  let seat = null;

  const emit = (type, payload) => {
    const set = handlers.get(type);
    if (set) for (const fn of set) { try { fn(payload); } catch {} }
  };

  const net = {
    isLocal: true,
    status: 'idle',
    clockOffset: 0,

    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },

    connect() {
      net.close();
      engine = createRaceEngine({ bots: { target: PRACTICE_BOTS } });
      const mySeat = engine.connect((obj) => {
        const m = JSON.parse(JSON.stringify(obj));
        queueMicrotask(() => { if (seat === mySeat) emit(m.t, m); });
      });
      seat = mySeat;
      net.status = 'open';
      queueMicrotask(() => { if (seat === mySeat) emit('status', 'open'); });
    },

    serverNow: () => Date.now(), // the "server" is this page; no offset

    send(obj) {
      if (!seat) return;
      const s = seat;
      const m = JSON.parse(JSON.stringify(obj));
      queueMicrotask(() => { if (seat === s) s.receive(m); });
    },

    close() {
      if (seat) { try { seat.close(); } catch {} seat = null; }
      if (engine) { try { engine.dispose(); } catch {} engine = null; }
      net.status = 'idle';
    },
  };

  return net;
}
