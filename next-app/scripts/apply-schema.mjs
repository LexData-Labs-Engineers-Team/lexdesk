// Apply next-app/db/schema.sql to the Neon database. Idempotent (schema uses
// IF NOT EXISTS). Prefers the direct (unpooled) endpoint for DDL. Run from next-app/:
//   node scripts/apply-schema.mjs
import { readFileSync } from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

if (typeof WebSocket === 'undefined') neonConfig.webSocketConstructor = ws;

function envFromFile() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line); if (m) out[m[1]] = m[2].replace(/^["'`]|["'`]$/g, ''); }
  return out;
}
const env = envFromFile();
const CONN = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!CONN) { console.error('DATABASE_URL(_UNPOOLED) not set'); process.exit(1); }

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const pool = new Pool({ connectionString: CONN });

console.log('Applying db/schema.sql …');
await pool.query(schema);

const { rows } = await pool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
);
console.log(`\n✅ Schema applied. ${rows.length} tables in public:`);
console.log('  ' + rows.map((r) => r.table_name).join(', '));
await pool.end();
process.exit(0);
