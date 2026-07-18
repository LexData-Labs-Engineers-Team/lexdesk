// One-time data migration: Firestore -> Neon Postgres. Firebase Auth + Storage
// stay; this moves only the DATA. Idempotent (re-runnable): append-only tables use
// ON CONFLICT DO NOTHING; singletons (policy, org) use DO UPDATE. Preserves doc ids.
//
// Prereqs (.env.local): FIREBASE_SERVICE_ACCOUNT, LEXDESK_ORG_ID, and a Neon
// connection string in DATABASE_URL (or DATABASE_URL_UNPOOLED for the direct,
// non-pooled endpoint — preferred for bulk loads). Apply next-app/db/schema.sql to
// the database first.
//
// Usage (from next-app/, ideally right after the ~1 PM BDT Spark reset):
//   node scripts/migrate-firestore-to-neon.mjs --count        # pre-flight doc counts (cheap)
//   node scripts/migrate-firestore-to-neon.mjs --dry-run      # transform, print first row/table, no writes
//   node scripts/migrate-firestore-to-neon.mjs                # full migration
//   node scripts/migrate-firestore-to-neon.mjs --only=attendanceEvents,users
//   node scripts/migrate-firestore-to-neon.mjs --skip=locationPings

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

if (typeof WebSocket === 'undefined') neonConfig.webSocketConstructor = ws;

// ---- env ----
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

const ORG_ID = get('LEXDESK_ORG_ID') || 'default';
const CONN = get('DATABASE_URL_UNPOOLED') || get('DATABASE_URL');
if (!CONN) { console.error('DATABASE_URL (or DATABASE_URL_UNPOOLED) not set.'); process.exit(1); }

const saRaw = get('FIREBASE_SERVICE_ACCOUNT');
if (!saRaw) { console.error('FIREBASE_SERVICE_ACCOUNT is not set.'); process.exit(1); }
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
const db = getFirestore();
const pool = new Pool({ connectionString: CONN });

// ---- flags ----
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagVal = (name) => { const a = flag(name); return a && a.includes('=') ? a.split('=').slice(1).join('=') : null; };
const DRY = !!flag('dry-run');
const COUNT_ONLY = !!flag('count');
const ONLY = flagVal('only') ? new Set(flagVal('only').split(',').map((s) => s.trim())) : null;
const SKIP = flagVal('skip') ? new Set(flagVal('skip').split(',').map((s) => s.trim())) : new Set();

// ---- transform helpers ----
// Firestore Timestamp / Date / ISO string -> JS Date (or null). Use ONLY for true
// timestamp fields; day/ISO STRING fields must stay strings (do not pass them here).
const ts = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d; }
  return null;
};
const tsNow = (v) => ts(v) ?? new Date();                 // for NOT NULL timestamptz columns
const num = (v) => (typeof v === 'number' ? v : null);
const jarr = (v) => (Array.isArray(v) ? v : []);          // -> text[]
const jstr = (v, def) => JSON.stringify(v === undefined ? def : v); // -> jsonb string

const orgPath = (sub) => `organizations/${ORG_ID}/${sub}`;

// ---- collection specs (Firestore -> Postgres) ----
const COLLECTIONS = [
  {
    name: 'users', path: orgPath('users'), table: 'users', pk: 'firebase_uid',
    jsonb: ['login_devices'],
    cols: ['firebase_uid', 'org_id', 'email', 'name', 'role', 'team_id', 'team_name', 'employee_id',
      'designation', 'department', 'contact_number', 'birth_date', 'joining_date', 'must_change_password',
      'face_embedding_b64', 'face_embedding_model', 'face_enrolled_at', 'photo_storage_path', 'photo_updated_at',
      'last_location_ping_at', 'created_at', 'login_devices', 'login_ip_allowlist'],
    toRow: (id, d) => ({
      firebase_uid: id, org_id: ORG_ID, email: d.email ?? null, name: d.name ?? null, role: d.role ?? null,
      team_id: d.teamId ?? null, team_name: d.teamName ?? null, employee_id: d.employeeId ?? null,
      designation: d.designation ?? null, department: d.department ?? null, contact_number: d.contactNumber ?? null,
      birth_date: d.birthDate ?? null, joining_date: d.joiningDate ?? null, must_change_password: !!d.mustChangePassword,
      face_embedding_b64: d.faceEmbeddingB64 ?? null, face_embedding_model: d.faceEmbeddingModel ?? null,
      face_enrolled_at: ts(d.faceEnrolledAt), photo_storage_path: d.photoStoragePath ?? null,
      photo_updated_at: ts(d.photoUpdatedAt), last_location_ping_at: ts(d.lastLocationPingAt),
      created_at: tsNow(d.createdAt), login_devices: jstr(d.loginDevices, []), login_ip_allowlist: jarr(d.loginIpAllowlist),
    }),
  },
  {
    name: 'teams', path: orgPath('teams'), table: 'teams', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'name', 'leader_uid', 'leader_name', 'created_at', 'created_by'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, name: d.name ?? '', leader_uid: d.leaderUid ?? null,
      leader_name: d.leaderName ?? null, created_at: tsNow(d.createdAt), created_by: d.createdBy ?? null }),
  },
  {
    name: 'attendanceEvents', path: orgPath('attendanceEvents'), table: 'attendance_events', pk: 'id',
    jsonb: ['raw_check_results'],
    cols: ['id', 'org_id', 'uid', 'user_email', 'user_name', 'office_id', 'type', 'timestamp', 'lat', 'lng',
      'accuracy_meters', 'ssid', 'bssid', 'client_ip', 'face_match_score', 'all_checks_passed', 'raw_check_results',
      'is_late', 'is_early', 'scheduled_start', 'scheduled_end', 'client_mode', 'web_device', 'api_key_id',
      'device_id', 'device_name', 'manual_by', 'manual_note'],
    toRow: (id, d) => ({
      id, org_id: ORG_ID, uid: d.uid ?? null, user_email: d.userEmail ?? null, user_name: d.userName ?? null,
      office_id: d.officeId ?? null, type: d.type ?? null, timestamp: tsNow(d.timestamp),
      lat: num(d.lat), lng: num(d.lng), accuracy_meters: num(d.accuracyMeters), ssid: d.ssid ?? null,
      bssid: d.bssid ?? null, client_ip: d.clientIp ?? null, face_match_score: num(d.faceMatchScore),
      all_checks_passed: typeof d.allChecksPassed === 'boolean' ? d.allChecksPassed : null,
      raw_check_results: jstr(d.rawCheckResults, []),
      is_late: typeof d.isLate === 'boolean' ? d.isLate : null, is_early: typeof d.isEarly === 'boolean' ? d.isEarly : null,
      scheduled_start: d.scheduledStart ?? null, scheduled_end: d.scheduledEnd ?? null, client_mode: d.clientMode ?? null,
      web_device: d.webDevice ?? null, api_key_id: d.apiKeyId ?? null, device_id: d.deviceId ?? null,
      device_name: d.deviceName ?? null, manual_by: d.manualBy ?? null, manual_note: d.manualNote ?? null,
    }),
  },
  {
    name: 'qrTokenUses', path: orgPath('qrTokenUses'), table: 'qr_token_uses', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'uid', 'token', 'token_key', 'valid_from', 'valid_until', 'used_at'],
    toRow: (id, d) => {
      const uid = d.uid ?? '';
      const tokenKey = uid && id.startsWith(`${uid}_`) ? id.slice(uid.length + 1) : id.split('_').slice(1).join('_') || id;
      return { id, org_id: ORG_ID, uid, token: d.token ?? null, token_key: tokenKey,
        valid_from: ts(d.validFrom), valid_until: ts(d.validUntil), used_at: tsNow(d.usedAt) };
    },
  },
  {
    name: 'devices', path: orgPath('devices'), table: 'devices', pk: 'device_id', jsonb: [],
    cols: ['device_id', 'org_id', 'uid', 'email', 'device_name', 'device_mac', 'first_seen_at', 'last_seen_at'],
    toRow: (id, d) => ({ device_id: id, org_id: ORG_ID, uid: d.uid ?? '', email: d.email ?? null,
      device_name: d.deviceName ?? null, device_mac: d.deviceMac ?? null,
      first_seen_at: tsNow(d.firstSeenAt), last_seen_at: tsNow(d.lastSeenAt) }),
  },
  {
    name: 'auditLogs', path: orgPath('auditLogs'), table: 'audit_logs', pk: 'id', jsonb: ['metadata'],
    cols: ['id', 'org_id', 'actor_uid', 'action', 'target_id', 'metadata', 'created_at'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, actor_uid: d.actorUid ?? null, action: d.action ?? null,
      target_id: d.targetId ?? null, metadata: d.metadata == null ? null : jstr(d.metadata), created_at: tsNow(d.createdAt) }),
  },
  {
    name: 'leaveRequests', path: orgPath('leaveRequests'), table: 'leave_requests', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'uid', 'user_email', 'user_name', 'from_day', 'to_day', 'total_days', 'leave_type',
      'half_day_period', 'department', 'line_manager', 'approved_by', 'subject', 'details', 'reason', 'status',
      'created_at', 'decided_at', 'decided_by', 'decision_note'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, uid: d.uid ?? null, user_email: d.userEmail ?? null, user_name: d.userName ?? null,
      from_day: d.fromDay ?? null, to_day: d.toDay ?? null, total_days: num(d.totalDays), leave_type: d.leaveType ?? null,
      half_day_period: d.halfDayPeriod ?? null, department: d.department ?? null, line_manager: d.lineManager ?? null,
      approved_by: d.approvedBy ?? null, subject: d.subject ?? null, details: d.details ?? null, reason: d.reason ?? null,
      status: d.status ?? 'pending', created_at: tsNow(d.createdAt), decided_at: ts(d.decidedAt),
      decided_by: d.decidedBy ?? null, decision_note: d.decisionNote ?? null }),
  },
  {
    name: 'assetRequests', path: orgPath('assetRequests'), table: 'asset_requests', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'uid', 'user_email', 'user_name', 'asset_name', 'asset_type', 'description', 'from_day',
      'to_day', 'total_days', 'requires_lead', 'status', 'admin_status', 'lead_status', 'admin_decided_by',
      'admin_decided_at', 'admin_note', 'lead_decided_by', 'lead_decided_at', 'lead_note', 'created_at'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, uid: d.uid ?? null, user_email: d.userEmail ?? null, user_name: d.userName ?? null,
      asset_name: d.assetName ?? null, asset_type: d.assetType ?? null, description: d.description ?? null,
      from_day: d.fromDay ?? null, to_day: d.toDay ?? null, total_days: num(d.totalDays), requires_lead: !!d.requiresLead,
      status: d.status ?? 'pending', admin_status: d.adminStatus ?? 'pending', lead_status: d.leadStatus ?? 'pending',
      admin_decided_by: d.adminDecidedBy ?? null, admin_decided_at: ts(d.adminDecidedAt), admin_note: d.adminNote ?? null,
      lead_decided_by: d.leadDecidedBy ?? null, lead_decided_at: ts(d.leadDecidedAt), lead_note: d.leadNote ?? null,
      created_at: tsNow(d.createdAt) }),
  },
  {
    name: 'reconRequests', path: orgPath('reconRequests'), table: 'recon_requests', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'uid', 'user_email', 'user_name', 'day', 'proposed_in_iso', 'proposed_out_iso', 'reason',
      'status', 'created_at', 'decided_at', 'decided_by', 'decision_note'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, uid: d.uid ?? null, user_email: d.userEmail ?? null, user_name: d.userName ?? null,
      day: d.day ?? null, proposed_in_iso: d.proposedInIso ?? null, proposed_out_iso: d.proposedOutIso ?? null,
      reason: d.reason ?? null, status: d.status ?? 'pending', created_at: tsNow(d.createdAt), decided_at: ts(d.decidedAt),
      decided_by: d.decidedBy ?? null, decision_note: d.decisionNote ?? null }),
  },
  {
    name: 'remoteRequests', path: orgPath('remoteRequests'), table: 'remote_requests', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'uid', 'user_email', 'user_name', 'day', 'reason', 'place', 'lat', 'lng', 'status',
      'started_at', 'ended_at', 'duration_minutes', 'created_at', 'decided_at', 'decided_by', 'decision_note'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, uid: d.uid ?? null, user_email: d.userEmail ?? null, user_name: d.userName ?? null,
      day: d.day ?? null, reason: d.reason ?? null, place: d.place ?? null, lat: num(d.lat), lng: num(d.lng),
      status: d.status ?? 'pending', started_at: ts(d.startedAt), ended_at: ts(d.endedAt),
      duration_minutes: num(d.durationMinutes), created_at: tsNow(d.createdAt), decided_at: ts(d.decidedAt),
      decided_by: d.decidedBy ?? null, decision_note: d.decisionNote ?? null }),
  },
  {
    name: 'holidays', path: orgPath('holidays'), table: 'holidays', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'from_day', 'to_day', 'name', 'created_at', 'created_by'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, from_day: d.fromDay ?? null, to_day: d.toDay ?? null, name: d.name ?? null,
      created_at: tsNow(d.createdAt), created_by: d.createdBy ?? null }),
  },
  {
    name: 'accessoryItems', path: orgPath('accessoryItems'), table: 'accessory_items', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'name', 'quantity', 'notes', 'created_at', 'created_by'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, name: d.name ?? null, quantity: typeof d.quantity === 'number' ? d.quantity : 0,
      notes: d.notes ?? null, created_at: tsNow(d.createdAt), created_by: d.createdBy ?? null }),
  },
  {
    name: 'trackingItems', path: orgPath('trackingItems'), table: 'tracking_items', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'name', 'ip_address', 'assigned_to', 'notes', 'created_at', 'created_by'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, name: d.name ?? null, ip_address: d.ipAddress ?? null,
      assigned_to: d.assignedTo ?? null, notes: d.notes ?? null, created_at: tsNow(d.createdAt), created_by: d.createdBy ?? null }),
  },
  {
    name: 'notices', path: orgPath('notices'), table: 'notices', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'title', 'body', 'pinned', 'created_at', 'created_by'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, title: d.title ?? null, body: d.body ?? null, pinned: !!d.pinned,
      created_at: tsNow(d.createdAt), created_by: d.createdBy ?? null }),
  },
  {
    name: 'breakEvents', path: orgPath('breakEvents'), table: 'break_events', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'uid', 'type', 'timestamp'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, uid: d.uid ?? null, type: d.type ?? null, timestamp: tsNow(d.timestamp) }),
  },
  {
    name: 'locationPings', path: orgPath('locationPings'), table: 'location_pings', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'uid', 'email', 'lat', 'lng', 'accuracy', 'captured_at', 'server_received_at', 'source', 'is_mock_location'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, uid: d.uid ?? null, email: d.email ?? null, lat: num(d.lat), lng: num(d.lng),
      accuracy: num(d.accuracy), captured_at: ts(d.capturedAt), server_received_at: tsNow(d.serverReceivedAt),
      source: d.source ?? null, is_mock_location: typeof d.isMockLocation === 'boolean' ? d.isMockLocation : null }),
  },
  {
    name: 'offices', path: orgPath('offices'), table: 'offices', pk: 'id', jsonb: [],
    cols: ['id', 'org_id', 'name', 'lat', 'lng', 'radius_meters', 'allowed_ssids', 'allowed_bssids', 'allowed_ips',
      'start_time', 'end_time', 'created_at', 'updated_at'],
    toRow: (id, d) => ({ id, org_id: ORG_ID, name: d.name ?? null, lat: num(d.lat), lng: num(d.lng),
      radius_meters: num(d.radiusMeters), allowed_ssids: jarr(d.allowedSsids), allowed_bssids: jarr(d.allowedBssids),
      allowed_ips: jarr(d.allowedIps), start_time: d.startTime ?? null, end_time: d.endTime ?? null,
      created_at: tsNow(d.createdAt), updated_at: tsNow(d.updatedAt) }),
  },
  // Singletons (upsert). policy is a fixed doc 'default'; org is the org document.
  {
    name: 'policy', path: orgPath('policy'), table: 'policy', pk: 'org_id', singleton: true, jsonb: [],
    conflictUpdate: ['require_wifi', 'require_ip', 'require_geo', 'require_qr', 'require_face', 'face_threshold', 'gps_accuracy_max_meters', 'updated_at'],
    cols: ['org_id', 'require_wifi', 'require_ip', 'require_geo', 'require_qr', 'require_face', 'face_threshold', 'gps_accuracy_max_meters', 'updated_at'],
    toRow: (_id, d) => ({ org_id: ORG_ID,
      require_wifi: typeof d.requireWifi === 'boolean' ? d.requireWifi : null,
      require_ip: typeof d.requireIp === 'boolean' ? d.requireIp : null,
      require_geo: typeof d.requireGeo === 'boolean' ? d.requireGeo : null,
      require_qr: typeof d.requireQr === 'boolean' ? d.requireQr : null,
      require_face: typeof d.requireFace === 'boolean' ? d.requireFace : null,
      face_threshold: num(d.faceThreshold), gps_accuracy_max_meters: num(d.gpsAccuracyMaxMeters), updated_at: tsNow(d.updatedAt) }),
  },
];

// ---- bulk insert ----
function buildBulk(table, cols, rows, jsonbCols, conflictClause) {
  const params = [];
  const tuples = rows.map((r) => {
    const ph = cols.map((c) => {
      params.push(r[c] === undefined ? null : r[c]);
      return jsonbCols.has(c) ? `$${params.length}::jsonb` : `$${params.length}`;
    });
    return `(${ph.join(',')})`;
  });
  const text = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflictClause}`;
  return { text, params };
}

async function* readDocs(collPath) {
  const coll = db.collection(collPath);
  let last = null;
  const PAGE = 1000;
  while (true) {
    let q = coll.orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) yield doc;
    last = snap.docs[snap.docs.length - 1].id;
    if (snap.size < PAGE) break;
  }
}

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

async function migrateOne(spec) {
  const jsonbCols = new Set(spec.jsonb || []);
  const conflict = spec.singleton && spec.conflictUpdate
    ? `ON CONFLICT (${spec.pk}) DO UPDATE SET ${spec.conflictUpdate.map((c) => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${spec.pk}) DO NOTHING`;

  const rows = [];
  if (spec.singleton && spec.name === 'policy') {
    const snap = await db.doc(`${spec.path}/default`).get();
    if (snap.exists) rows.push(spec.toRow('default', snap.data() || {}));
  } else {
    for await (const doc of readDocs(spec.path)) rows.push(spec.toRow(doc.id, doc.data() || {}));
  }

  if (DRY) {
    console.log(`  [dry] ${spec.name}: read ${rows.length}; first row:`, rows[0] ? JSON.stringify(rows[0]).slice(0, 400) : '(none)');
    return { name: spec.name, read: rows.length, written: 0 };
  }

  let written = 0;
  for (const batch of chunk(rows, 500)) {
    const { text, params } = buildBulk(spec.table, spec.cols, batch, jsonbCols, conflict);
    const res = await pool.query(text, params);
    written += res.rowCount ?? 0;
  }
  const { rows: cnt } = await pool.query(`SELECT count(*)::int AS n FROM ${spec.table} WHERE org_id = $1`, [ORG_ID]);
  console.log(`  ${spec.name}: read ${rows.length}, inserted ${written}, table total ${cnt[0].n}`);
  return { name: spec.name, read: rows.length, written, total: cnt[0].n };
}

// The org document is a single doc (not a collection). Handle separately.
async function migrateOrg() {
  if (SKIP.has('org') || (ONLY && !ONLY.has('org'))) return null;
  const snap = await db.doc(`organizations/${ORG_ID}`).get();
  if (!snap.exists) { console.log('  org: (no org document)'); return { name: 'org', read: 0, written: 0 }; }
  const d = snap.data() || {};
  const row = { id: ORG_ID, name: d.name ?? null, source: d.source ?? null, created_at: ts(d.createdAt), updated_at: ts(d.updatedAt) };
  if (DRY) { console.log('  [dry] org first row:', JSON.stringify(row)); return { name: 'org', read: 1, written: 0 }; }
  await pool.query(
    `INSERT INTO org (id, name, source, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, source=EXCLUDED.source, updated_at=EXCLUDED.updated_at`,
    [row.id, row.name, row.source, row.created_at, row.updated_at],
  );
  console.log('  org: upserted 1');
  return { name: 'org', read: 1, written: 1 };
}

async function countAll() {
  console.log(`Pre-flight document counts (org ${ORG_ID}):`);
  let total = 0;
  for (const spec of COLLECTIONS) {
    if (spec.singleton) {
      const s = await db.doc(`${spec.path}/default`).get();
      const n = s.exists ? 1 : 0; total += n; console.log(`  ${spec.name}: ${n}`); continue;
    }
    const agg = await db.collection(spec.path).count().get();
    const n = agg.data().count; total += n;
    console.log(`  ${spec.name}: ${n}`);
  }
  console.log(`  ---\n  TOTAL (excl. org doc, userIndex): ${total} document reads for a full export.`);
  console.log(total > 45000
    ? '  ⚠ Close to / over the Spark 50K/day cap. Consider --skip=locationPings, or run in two windows.'
    : '  ✓ Comfortably under the 50K/day Spark cap for a single post-reset window.');
}

// ---- run ----
console.log(`Migration: Firestore org "${ORG_ID}" -> Neon${DRY ? ' (DRY RUN)' : ''}`);
if (COUNT_ONLY) { await countAll(); await pool.end(); process.exit(0); }

const report = [];
for (const spec of COLLECTIONS) {
  if (SKIP.has(spec.name)) { console.log(`  ${spec.name}: skipped`); continue; }
  if (ONLY && !ONLY.has(spec.name)) continue;
  report.push(await migrateOne(spec));
}
const orgRes = await migrateOrg();
if (orgRes) report.push(orgRes);

console.log('\nReconciliation:');
for (const r of report) console.log(`  ${r.name.padEnd(18)} read=${r.read}  written=${r.written}${r.total != null ? `  total=${r.total}` : ''}`);
console.log(`\n${DRY ? 'Dry run complete (no writes).' : '✅ Migration complete.'}`);
await pool.end();
process.exit(0);
