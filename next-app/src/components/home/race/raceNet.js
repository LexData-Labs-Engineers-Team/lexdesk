'use client';

// WebSocket client for the Nebula Grand Prix. Owns the socket, a typed handler
// registry, and — critically for sync — a smoothed estimate of the server
// clock offset. Countdowns and the GO moment are all scheduled on server time,
// so every pilot's race starts at the same real-world instant regardless of
// whose laptop clock is wrong.
//
// Connection strategy: the arena may live at several addresses depending on
// how the app is hosted, so we try candidates in order instead of pinning one:
//   1. NEXT_PUBLIC_RACE_WS_URL   — explicit override (hosted relay; inlined at build)
//   2. same-origin /race-ws      — the default: the Next custom server mounts
//                                  the arena on the app's own port, so if you
//                                  can load the page you can join the race
//                                  (this is what fixed LAN play — no second
//                                  port for firewalls to eat)
//   3. <hostname>:3990           — legacy standalone relay
// A URL that works is remembered for the whole session (probe + reconnects).

const LEGACY_PORT = 3990;
const CONNECT_TIMEOUT_MS = 3000;   // per-candidate handshake budget
const RECONNECT_DELAYS = [700, 1400, 2800, 5000, 8000]; // then give up → 'closed'

let knownGoodUrl = null;

export function raceWsCandidates() {
  const list = [];
  if (process.env.NEXT_PUBLIC_RACE_WS_URL) list.push(process.env.NEXT_PUBLIC_RACE_WS_URL);
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    list.push(`${proto}//${window.location.host}/race-ws`);
    list.push(`${proto}//${window.location.hostname}:${LEGACY_PORT}`);
  } else {
    list.push(`ws://localhost:3000/race-ws`, `ws://localhost:${LEGACY_PORT}`);
  }
  const ordered = knownGoodUrl ? [knownGoodUrl, ...list] : list;
  return [...new Set(ordered)];
}

export class RaceNet {
  constructor() {
    this.ws = null;
    this.handlers = new Map(); // type -> Set<fn>
    this.status = 'idle';      // idle | connecting | open | reconnecting | closed
    this.clockOffset = 0;      // serverNow ≈ Date.now() + clockOffset
    this._offsetSamples = 0;
    this._round = 0;           // reconnect round counter (resets on open)
    this._retryTimer = null;
    this._manual = false;      // true while close() is intentional
    this._everOpen = false;    // gates auto-reconnect: only re-dial a link we once had
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

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this._emit('status', s);
  }

  // Kick off a connection round: walk the candidate list until one opens.
  connect() {
    this._teardown();
    this._manual = false;
    clearTimeout(this._retryTimer);
    this._round = 0;
    this._setStatus('connecting');
    this._tryCandidates(raceWsCandidates(), 0);
  }

  _tryCandidates(urls, i) {
    if (this._manual) return;
    if (i >= urls.length) return this._roundFailed();

    let ws;
    try {
      ws = new WebSocket(urls[i]);
    } catch {
      return this._tryCandidates(urls, i + 1);
    }
    this.ws = ws;
    let settled = false;
    const guard = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null; ws.close(); } catch {}
      if (this.ws === ws) this.ws = null;
      this._tryCandidates(urls, i + 1);
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      knownGoodUrl = urls[i];
      this._round = 0;
      this._everOpen = true;
      this._wire(ws);
      this._setStatus('open');
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (this.ws === ws) this.ws = null;
      this._tryCandidates(urls, i + 1);
    };
  }

  // Handlers for an ESTABLISHED socket (candidate probing has its own).
  _wire(ws) {
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by a newer connection
      this.ws = null;
      if (this._manual) return;
      this._roundFailed(); // link dropped — start auto-reconnect rounds
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

  _roundFailed() {
    if (this._manual) return;
    // Never-connected: one full sweep of the candidates is the answer — fail
    // fast to 'closed' so the arena-offline screen (with its AI-practice
    // offer) appears immediately instead of after ~20s of doomed retries.
    // Auto-reconnect rounds are reserved for links we actually had.
    if (!this._everOpen) return this._setStatus('closed');
    if (this._round >= RECONNECT_DELAYS.length) return this._setStatus('closed');
    const delay = RECONNECT_DELAYS[this._round] * (0.8 + Math.random() * 0.4);
    this._round += 1;
    this._setStatus('reconnecting');
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      if (this._manual) return;
      this._tryCandidates(raceWsCandidates(), 0);
    }, delay);
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

  _teardown() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null; ws.close(); } catch {}
    }
  }

  close() {
    this._manual = true;
    clearTimeout(this._retryTimer);
    this._teardown();
    this.status = 'idle';
  }
}

// One-shot probe used by the hub station panel: races every candidate URL and
// resolves with {pilots, humans, bots, phase} from the first arena that
// answers, or null if none do. Never throws, never hangs (~2.5s cap). A winner
// is remembered so the real connection goes straight to the right address.
export function peekArena() {
  const urls = raceWsCandidates();
  return new Promise((resolve) => {
    let settled = false;
    let pending = urls.length;
    const sockets = [];
    const done = (v) => {
      if (settled) return;
      settled = true;
      for (const s of sockets) { try { s.close(); } catch {} }
      resolve(v);
    };
    const oneFailed = () => { if (--pending <= 0) done(null); };

    for (const url of urls) {
      let ws;
      try { ws = new WebSocket(url); } catch { oneFailed(); continue; }
      sockets.push(ws);
      // A dead candidate fires error AND close (and maybe the timeout) — count
      // each socket's failure exactly once or the tally lies about the rest.
      let failed = false;
      const fail = () => {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        oneFailed();
      };
      const timer = setTimeout(fail, 2500);
      ws.onopen = () => { try { ws.send(JSON.stringify({ t: 'peek' })); } catch {} };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.t === 'peekInfo') {
            clearTimeout(timer);
            knownGoodUrl = url;
            done({ pilots: m.pilots, humans: m.humans ?? m.pilots, bots: m.bots ?? 0, phase: m.phase });
          }
        } catch {}
      };
      ws.onerror = fail;
      ws.onclose = fail;
    }
    if (!urls.length) done(null);
  });
}
