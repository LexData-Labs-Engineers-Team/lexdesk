import { neon, Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Neon's Pool (interactive transactions over WebSocket) needs a WebSocket
// constructor. Node 22+ exposes a global WebSocket; older Node (some local dev)
// does not, so fall back to the `ws` package. The HTTP `sql` path needs neither.
if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

// Lazy init: importing this module must NOT require DATABASE_URL (so `next build`
// can bundle route modules before the env var exists). The connection is created
// on first query and the missing-env error surfaces at request time.
function connectionString() {
  const c = process.env.DATABASE_URL;
  if (!c) throw new Error('DATABASE_URL is not set');
  return c;
}

let _sql;
function getSql() {
  return (_sql ??= neon(connectionString()));
}

// Autocommit query helper. Two call styles, both resolving to an array of rows
// (snake_case keys):
//   const rows = await sql`SELECT * FROM users WHERE firebase_uid = ${uid}`;
//   const rows = await sql.query('SELECT * FROM t WHERE x = $1', [x]);
export function sql(strings, ...values) {
  return getSql()(strings, ...values);
}
sql.query = (text, params) => getSql().query(text, params);

// Interactive-transaction helper (SELECT ... FOR UPDATE read-modify-write).
// A module-scoped singleton Pool: on Vercel Fluid Compute a warm instance serves
// many concurrent requests, so one shared pool is correct — never new Pool() per
// request. client.query(text, params) -> { rows }.
let _pool;
function pool() {
  return (_pool ??= new Pool({ connectionString: connectionString(), max: 4 }));
}

export async function withTransaction(fn) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw err;
  } finally {
    client.release();
  }
}
