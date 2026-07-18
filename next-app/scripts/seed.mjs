// One-time bootstrap for a FRESH deployment: creates the org, the first ADMIN
// (Firebase Auth + Postgres), and a default attendance policy so you can log in
// and start adding employees from the dashboard.
//
// Data lives in Neon Postgres; Auth stays on Firebase. Apply db/schema.sql first.
// Prereqs: .env.local has FIREBASE_SERVICE_ACCOUNT, LEXDESK_ORG_ID and a Neon
// DATABASE_URL (or DATABASE_URL_UNPOOLED). Then run (PowerShell):
//   $env:SEED_COMPANY="LexData Labs"; $env:SEED_ADMIN_NAME="Your Name";
//   $env:SEED_ADMIN_EMAIL="admin@lexdatalabs.com"; $env:SEED_ADMIN_PASSWORD="Strong#Pass1";
//   node scripts/seed.mjs
// Idempotent: re-running updates the admin's password/profile rather than erroring.

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
const company = process.env.SEED_COMPANY;
const adminName = process.env.SEED_ADMIN_NAME;
const adminEmail = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

const missing = [];
if (!ORG_ID) missing.push('LEXDESK_ORG_ID (in .env.local)');
if (!CONN) missing.push('DATABASE_URL (in .env.local)');
if (!company) missing.push('SEED_COMPANY');
if (!adminName) missing.push('SEED_ADMIN_NAME');
if (!adminEmail) missing.push('SEED_ADMIN_EMAIL');
if (!adminPassword || adminPassword.length < 6) missing.push('SEED_ADMIN_PASSWORD (>=6 chars)');
if (missing.length) {
  console.error('Missing required values:\n  - ' + missing.join('\n  - '));
  process.exit(1);
}

const saRaw = get('FIREBASE_SERVICE_ACCOUNT');
if (!saRaw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set in .env.local');
  process.exit(1);
}
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

// 1) Org row (Postgres)
await pool.query(
  `INSERT INTO org (id, name, source, created_at, updated_at)
   VALUES ($1, $2, 'lexdesk', now(), now())
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, source = EXCLUDED.source, updated_at = now()`,
  [ORG_ID, company],
);

// 2) First admin in Firebase Auth (create or update)
let uid;
try {
  const existing = await auth.getUserByEmail(adminEmail);
  uid = existing.uid;
  await auth.updateUser(uid, { password: adminPassword, displayName: adminName, emailVerified: true });
  console.log(`Admin already existed — updated password/profile (uid ${uid}).`);
} catch {
  const rec = await auth.createUser({ email: adminEmail, password: adminPassword, displayName: adminName, emailVerified: true });
  uid = rec.uid;
  console.log(`Created admin in Firebase Auth (uid ${uid}).`);
}
await auth.setCustomUserClaims(uid, { role: 'ADMIN', orgId: ORG_ID, email: adminEmail });

// 3) Admin profile row (Postgres). userIndex is gone — role lives on users.role.
await pool.query(
  `INSERT INTO users (firebase_uid, org_id, email, name, role, must_change_password, created_at)
   VALUES ($1, $2, $3, $4, 'ADMIN', false, now())
   ON CONFLICT (firebase_uid) DO UPDATE
     SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role,
         must_change_password = EXCLUDED.must_change_password`,
  [uid, ORG_ID, adminEmail, adminName],
);

// 4) Default policy (geo-only + lenient) so check-in works once an office is set.
//    Admin tunes this + adds the office/location in the dashboard.
const policyRes = await pool.query(
  `INSERT INTO policy (org_id, require_wifi, require_ip, require_geo, require_qr, require_face,
                       face_threshold, gps_accuracy_max_meters, updated_at)
   VALUES ($1, false, false, true, false, false, 0.6, 100, now())
   ON CONFLICT (org_id) DO NOTHING`,
  [ORG_ID],
);
if (policyRes.rowCount) console.log('Seeded default attendance policy (geo-only).');

console.log('\n✅ Seed complete.');
console.log(`   Org:   ${company}  (LEXDESK_ORG_ID=${ORG_ID})`);
console.log(`   Admin: ${adminEmail}  (role ADMIN)`);
console.log('   Next: log in with that email/password, then add the Office location + employees in the dashboard.');
await pool.end();
process.exit(0);
