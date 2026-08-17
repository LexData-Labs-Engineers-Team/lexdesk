// Audit the join between Neon `users` rows and Firebase Auth accounts.
//
// The invariant the whole app rests on is users.firebase_uid === the Firebase Auth
// uid. Nothing enforces it: scripts/migrate-firestore-to-neon.mjs copied Firestore
// doc ids in verbatim (and copied `email` un-normalized) without ever consulting
// Auth, and deleteEmployee historically removed the Auth account before the row.
// This script reports where the two sides disagree. It is READ-ONLY — it never
// writes to Neon or Firebase.
//
// Run from next-app/:
//   node scripts/audit-auth-links.mjs            # report
//   node scripts/audit-auth-links.mjs --reverse  # also list Auth accounts with no row
//   node scripts/audit-auth-links.mjs --strict   # exit 1 if anything is not OK
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

if (typeof WebSocket === 'undefined') neonConfig.webSocketConstructor = ws;

function envFromFile() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line); if (m) out[m[1]] = m[2].replace(/^["'`]|["'`]$/g, ''); }
  return out;
}
const fileEnv = envFromFile();
const get = (k) => process.env[k] || fileEnv[k];

const REVERSE = process.argv.includes('--reverse');
const STRICT = process.argv.includes('--strict');

const CONN = get('DATABASE_URL_UNPOOLED') || get('DATABASE_URL');
if (!CONN) { console.error('DATABASE_URL(_UNPOOLED) not set'); process.exit(1); }
const ORG_ID = get('LEXDESK_ORG_ID') || 'default';

const rawSa = get('FIREBASE_SERVICE_ACCOUNT');
if (!rawSa) { console.error('FIREBASE_SERVICE_ACCOUNT not set'); process.exit(1); }
const sa = JSON.parse(rawSa.trim().startsWith('{') ? rawSa.trim() : Buffer.from(rawSa.trim(), 'base64').toString('utf8'));
initializeApp({
  credential: cert({
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    privateKey: String(sa.private_key || '').replace(/\\n/g, '\n'),
  }),
});
const auth = getAuth();

console.log(`\nFirebase project : ${sa.project_id}`);
console.log(`Org id           : ${ORG_ID}`);

const pool = new Pool({ connectionString: CONN });
const { rows } = await pool.query(
  `SELECT firebase_uid, email, name, role FROM users WHERE org_id = $1 ORDER BY role, email`,
  [ORG_ID],
);
console.log(`Neon users rows  : ${rows.length}\n`);

// One getUsers() call per 100 rows rather than one getUser() per row.
const authByUid = new Map();
const missingUids = new Set();
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100);
  const res = await auth.getUsers(chunk.map((r) => ({ uid: r.firebase_uid })));
  for (const u of res.users) authByUid.set(u.uid, u);
  for (const nf of res.notFound) missingUids.add(nf.uid);
}

// An Auth record whose uid is missing may still be reachable by email — that
// distinguishes a repairable ORPHAN from a UID_CONFLICT needing a human.
async function uidOwningEmail(email) {
  try {
    const rec = await auth.getUserByEmail(email);
    return rec.uid;
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return null;
    throw err;
  }
}

const buckets = { OK: [], DIRTY_EMAIL: [], EMAIL_SKEW: [], ORPHAN: [], UID_CONFLICT: [], NO_EMAIL: [], DUPLICATE_EMAIL: [] };

// users.email carries no unique constraint (db/schema.sql), so flag collisions —
// they silently reroute any email-keyed lookup to whichever row is found first.
const emailCounts = new Map();
for (const r of rows) {
  const e = String(r.email || '').trim().toLowerCase();
  if (e) emailCounts.set(e, (emailCounts.get(e) || 0) + 1);
}

for (const r of rows) {
  const raw = String(r.email ?? '');
  const email = raw.trim().toLowerCase();
  const entry = { uid: r.firebase_uid, email: raw, name: r.name, role: r.role, note: '' };

  if (!email) { buckets.NO_EMAIL.push(entry); continue; }
  if (emailCounts.get(email) > 1) {
    entry.note = `${emailCounts.get(email)} Neon rows share this email`;
    buckets.DUPLICATE_EMAIL.push(entry);
    continue;
  }

  if (missingUids.has(r.firebase_uid)) {
    const owner = await uidOwningEmail(email);
    if (owner) { entry.note = `email belongs to Auth uid ${owner}`; buckets.UID_CONFLICT.push(entry); }
    else buckets.ORPHAN.push(entry);
    continue;
  }

  const rec = authByUid.get(r.firebase_uid);
  const authEmail = String(rec?.email || '');
  if (authEmail.toLowerCase() !== email) {
    entry.note = `Auth has "${authEmail || '—'}"`;
    buckets.EMAIL_SKEW.push(entry);
  } else if (raw !== email) {
    entry.note = 'stored with case/whitespace noise';
    buckets.DIRTY_EMAIL.push(entry);
  } else {
    buckets.OK.push(entry);
  }
}

const REMEDY = {
  OK: 'nothing to do',
  DIRTY_EMAIL: 'cosmetic — normalize the stored email',
  EMAIL_SKEW: 'Auth account exists at this uid; repair can resync the email',
  ORPHAN: 'no Auth account — Dev "Repair sign-in account", or delete the row if they have left',
  UID_CONFLICT: 'needs a human: the row PK is stale, or the email is a typo. Repair refuses these',
  NO_EMAIL: 'add an email to the profile first',
  DUPLICATE_EMAIL: 'de-duplicate the rows before any email-keyed operation',
};

for (const [state, list] of Object.entries(buckets)) {
  if (state === 'OK' || !list.length) continue;
  console.log(`${state} (${list.length}) — ${REMEDY[state]}`);
  for (const e of list) {
    console.log(`  ${e.uid}  ${e.email || '—'}  [${e.role || '—'}]  ${e.name || ''}${e.note ? `  ← ${e.note}` : ''}`);
  }
  console.log('');
}

const bad = rows.length - buckets.OK.length;
console.log(`${rows.length} rows · ${buckets.OK.length} OK · ${bad} needing attention`);

if (REVERSE) {
  const known = new Set(rows.map((r) => r.firebase_uid));
  const extra = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) if (!known.has(u.uid)) extra.push(u);
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(`\nAuth accounts with no users row in this org (${extra.length}):`);
  for (const u of extra) console.log(`  ${u.uid}  ${u.email || '—'}`);
}

await pool.end();
process.exit(STRICT && bad > 0 ? 1 : 0);
