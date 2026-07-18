// Create ONE system admin (role SUPER_ADMIN) in the existing org — a higher
// account than the org ADMIN, able to reset the org admin's password.
// Data lives in Neon Postgres; Auth stays on Firebase.
// Prereqs: .env.local has FIREBASE_SERVICE_ACCOUNT, LEXDESK_ORG_ID and a Neon
// DATABASE_URL (or DATABASE_URL_UNPOOLED). Run:
//   $env:SEED_SA_NAME="..."; $env:SEED_SA_EMAIL="sysadmin@lexdatalabs.com";
//   $env:SEED_SA_PASSWORD="Strong#Pass1"; node scripts/seed-superadmin.mjs
// Idempotent: re-running updates the password/profile.

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

if (typeof WebSocket === 'undefined') neonConfig.webSocketConstructor = ws;

function envFromFile() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const fileEnv = envFromFile();
const get = (k) => process.env[k] || fileEnv[k];

const ORG_ID = get('LEXDESK_ORG_ID');
const CONN = get('DATABASE_URL_UNPOOLED') || get('DATABASE_URL');
const name = process.env.SEED_SA_NAME;
const email = (process.env.SEED_SA_EMAIL || '').toLowerCase();
const password = process.env.SEED_SA_PASSWORD;

const missing = [];
if (!ORG_ID) missing.push('LEXDESK_ORG_ID (in .env.local)');
if (!CONN) missing.push('DATABASE_URL (in .env.local)');
if (!name) missing.push('SEED_SA_NAME');
if (!email) missing.push('SEED_SA_EMAIL');
if (!password || password.length < 6) missing.push('SEED_SA_PASSWORD (>=6 chars)');
if (missing.length) {
  console.error('Missing required values:\n  - ' + missing.join('\n  - '));
  process.exit(1);
}

const saRaw = get('FIREBASE_SERVICE_ACCOUNT');
if (!saRaw) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
const saJson = saRaw.trim().startsWith('{') ? saRaw : Buffer.from(saRaw, 'base64').toString('utf8');
const sa = JSON.parse(saJson);

initializeApp({
  credential: cert({
    projectId: sa.project_id ?? sa.projectId,
    clientEmail: sa.client_email ?? sa.clientEmail,
    privateKey: (sa.private_key ?? sa.privateKey).replace(/\\n/g, '\n'),
  }),
  projectId: sa.project_id ?? sa.projectId,
});
const auth = getAuth();
const pool = new Pool({ connectionString: CONN });

let uid;
try {
  const existing = await auth.getUserByEmail(email);
  uid = existing.uid;
  await auth.updateUser(uid, { password, displayName: name, emailVerified: true });
  console.log(`System admin already existed — updated (uid ${uid}).`);
} catch {
  const rec = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  uid = rec.uid;
  console.log(`Created system admin in Firebase Auth (uid ${uid}).`);
}
await auth.setCustomUserClaims(uid, { role: 'SUPER_ADMIN', orgId: ORG_ID, email });

// Profile row (Postgres). userIndex is gone — role lives on users.role.
await pool.query(
  `INSERT INTO users (firebase_uid, org_id, email, name, role, must_change_password, created_at)
   VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', false, now())
   ON CONFLICT (firebase_uid) DO UPDATE
     SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role,
         must_change_password = EXCLUDED.must_change_password`,
  [uid, ORG_ID, email, name],
);

console.log(`\n✅ System admin ready: ${email} (role SUPER_ADMIN, org ${ORG_ID}).`);
console.log('   Log in with it, open the org admin\'s profile (Employees → admin), and Reset password.');
await pool.end();
process.exit(0);
