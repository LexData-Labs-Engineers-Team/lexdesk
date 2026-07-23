// Bridges real WebSockets to arena-engine seats. Shared by the standalone
// relay (race-server/server.mjs) and the Next custom server (server.mjs at the
// app root, which mounts the arena at /race-ws on the app's own port).
// Lives apart from the CLI entry so importing it never starts a listener.
// Ping/pong liveness is handled here because it's a ws-transport concern —
// the engine itself is transport-agnostic.

export function attachEngineToSocketServer(engine, socketServer) {
  // One stringify per broadcast object, shared across all sockets.
  const encoded = new WeakMap();
  const encode = (obj) => {
    let raw = encoded.get(obj);
    if (!raw) { raw = JSON.stringify(obj); encoded.set(obj, raw); }
    return raw;
  };

  socketServer.on('connection', (ws) => {
    const seat = engine.connect((obj) => {
      if (ws.readyState === 1) { try { ws.send(encode(obj)); } catch {} }
    });
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      seat.receive(m);
    });
    ws.on('close', () => seat.close());
    ws.on('error', () => {});
  });

  // Reap dead connections so ghosts never hold a grid slot.
  const reaper = setInterval(() => {
    for (const ws of socketServer.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 15_000);
  socketServer.on('close', () => clearInterval(reaper));
}
