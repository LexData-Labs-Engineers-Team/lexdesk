'use client';

// WebSocket client for the Nebula Grand Prix. Owns the socket, a typed handler
// registry, and — critically for sync — a smoothed estimate of the server
// clock offset. Countdowns and the GO moment are all scheduled on server time,
// so every pilot's race starts at the same real-world instant regardless of
// whose laptop clock is wrong.

export function raceWsUrl() {
  if (process.env.NEXT_PUBLIC_RACE_WS_URL) return process.env.NEXT_PUBLIC_RACE_WS_URL;
  if (typeof window === 'undefined') return 'ws://localhost:3990';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:3990`;
}

export class RaceNet {
  constructor() {
    this.ws = null;
    this.handlers = new Map(); // type -> Set<fn>
    this.status = 'idle';      // idle | connecting | open | closed
    this.clockOffset = 0;      // serverNow ≈ Date.now() + clockOffset
    this._offsetSamples = 0;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  _emit(type, payload) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) { try { fn(payload); } catch {} }
  }

  connect(url = raceWsUrl()) {
    this.close();
    this.status = 'connecting';
    this._emit('status', this.status);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.status = 'closed';
      this._emit('status', this.status);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'open';
      this._emit('status', this.status);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by a newer connection
      this.status = 'closed';
      this._emit('status', this.status);
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      // Any server timestamp refines our clock-offset estimate (EWMA — first
      // sample snaps, later samples nudge, so one laggy packet can't skew it).
      if (typeof m.now === 'number') {
        const sample = m.now - Date.now();
        this._offsetSamples += 1;
        this.clockOffset = this._offsetSamples === 1
          ? sample
          : this.clockOffset * 0.85 + sample * 0.15;
      }
      this._emit(m.t, m);
    };
  }

  // Server-clock "now" — compare against countdownEndsAt / startAt directly.
  serverNow() {
    return Date.now() + this.clockOffset;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch {}
    }
  }

  close() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null; ws.close(); } catch {}
    }
    this.status = 'idle';
  }
}

// One-shot probe used by the hub station panel: resolves with {pilots, phase}
// or null if the arena is unreachable. Never throws, never hangs (2s cap).
export function peekArena() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let ws;
    try { ws = new WebSocket(raceWsUrl()); } catch { return done(null); }
    const timer = setTimeout(() => { try { ws.close(); } catch {} done(null); }, 2000);
    ws.onopen = () => { try { ws.send(JSON.stringify({ t: 'peek' })); } catch {} };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.t === 'peekInfo') {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          done({ pilots: m.pilots, phase: m.phase });
        }
      } catch {}
    };
    ws.onerror = () => { clearTimeout(timer); done(null); };
    ws.onclose = () => { clearTimeout(timer); done(null); };
  });
}
