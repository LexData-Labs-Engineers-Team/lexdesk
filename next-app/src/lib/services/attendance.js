import crypto from 'node:crypto';
import { sql } from '../db';
import { rowToObject, tsToIso, buildInsert } from '../rows';
import { getFeatures } from './features';
import { isWithinGeofence, haversineMeters } from './geofence';
import { validateQrToken } from './qrToken';
import { FACE_EMBEDDING_DIM, cosineSimilarity, decodeEmbedding } from './face';
import { ipInAllowlist } from '../ip';

// Ported from AttendDesk's processCheckIn, trimmed to the web client: no
// kiosk/external/device-binding branches (LexDesk web is always a 'mobile'
// client). Same anti-cheat logic, thresholds, Asia/Dhaka late/early, and the
// exact attendanceEvent doc shape so existing reports/AttendDesk stay valid.

function bdHhmm(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

function hashTokenForKey(token, organizationId) {
  return crypto.createHash('sha256').update(`${organizationId}:${token}`).digest('hex').slice(0, 32);
}

export async function processCheckIn(uid, organizationId, userEmail, payload) {
  const [policyRows, officeRows, userRows, features] = await Promise.all([
    sql`SELECT * FROM policy WHERE org_id = ${organizationId}`,
    sql`SELECT * FROM offices WHERE org_id = ${organizationId} LIMIT 1`,
    sql`SELECT * FROM users WHERE firebase_uid = ${uid}`,
    getFeatures(organizationId),
  ]);

  if (!policyRows.length) throw Object.assign(new Error('policy_not_configured'), { status: 404 });
  if (!officeRows.length) throw Object.assign(new Error('office_not_configured'), { status: 404 });
  if (!userRows.length) throw Object.assign(new Error('user_not_found'), { status: 404 });

  const policy = rowToObject(policyRows[0]);
  const office = rowToObject(officeRows[0]);
  const user = rowToObject(userRows[0]);

  const ssidNorm = (payload.ssid ?? '').replace(/^"|"$/g, '').trim();
  const bssidNorm = (payload.bssid ?? '').toLowerCase().trim();
  const results = [];

  // --- WiFi ---
  if (features.verify.wifi) {
    const ssidMatch = ssidNorm !== '' && (office.allowedSsids || []).includes(ssidNorm);
    const bssidMatch =
      bssidNorm !== '' && (office.allowedBssids || []).map((b) => b.toLowerCase()).includes(bssidNorm);
    results.push({
      name: 'wifi',
      required: policy.requireWifi,
      passed: ssidMatch || bssidMatch,
      reason: ssidMatch || bssidMatch ? undefined : 'ssid_and_bssid_not_in_allowlist',
      details: { ssid: ssidNorm || null, bssid: bssidNorm || null, ssidMatch, bssidMatch },
    });
  }

  // --- Office IP (web only — the mobile app never sends payload.clientIp) ---
  if (payload.clientIp !== undefined) {
    const allowedIps = office.allowedIps || [];
    const requireIp = !!policy.requireIp;
    // Only surface a pass/fail when IP is actually in use (enforced, or an
    // allowlist is configured); otherwise just record the IP on the event.
    if (requireIp || allowedIps.length > 0) {
      let ipPassed;
      let ipReason;
      if (!payload.clientIp) {
        ipPassed = false; ipReason = 'missing_ip';
      } else if (allowedIps.length === 0) {
        // Fail-closed: enforcing with no allowlist configured would silently pass.
        ipPassed = false; ipReason = 'office_ip_not_configured';
      } else if (ipInAllowlist(payload.clientIp, allowedIps)) {
        ipPassed = true;
      } else {
        ipPassed = false; ipReason = 'ip_not_in_allowlist';
      }
      results.push({
        name: 'ip',
        required: requireIp,
        passed: ipPassed,
        reason: ipPassed ? undefined : ipReason,
        details: { ip: payload.clientIp || null },
      });
    }
  }

  // --- Geofence ---
  let distanceM;
  if (features.verify.gps) {
    let geoPassed = false;
    let geoReason;
    if (payload.isMockLocation) {
      geoReason = 'mock_location';
    } else if (
      payload.lat == null ||
      payload.lng == null ||
      payload.accuracyMeters == null
    ) {
      geoReason = 'missing_location';
    } else if (payload.accuracyMeters > policy.gpsAccuracyMaxMeters) {
      geoReason = 'low_accuracy';
    } else {
      const within = isWithinGeofence(
        { lat: payload.lat, lng: payload.lng },
        { lat: office.lat, lng: office.lng, radiusMeters: office.radiusMeters },
      );
      geoPassed = within;
      if (!within) geoReason = 'outside_geofence';
      distanceM = haversineMeters({ lat: payload.lat, lng: payload.lng }, { lat: office.lat, lng: office.lng });
    }
    results.push({
      name: 'geo',
      required: policy.requireGeo,
      passed: geoPassed,
      reason: geoReason,
      details: {
        accuracyMeters: payload.accuracyMeters ?? null,
        isMock: payload.isMockLocation === true,
        distanceMeters: distanceM ?? null,
      },
    });
  }

  // --- QR (with replay prevention) ---
  if (features.verify.qr) {
    let qrPassed = false;
    let qrReason;
    if (!payload.qrToken) {
      qrReason = 'missing_qr_token';
    } else {
      const v = validateQrToken(payload.qrToken, organizationId);
      if (!v.valid) {
        qrReason = 'invalid_qr_token';
      } else {
        const tokenKey = hashTokenForKey(payload.qrToken, organizationId);
        const useKey = `${uid}_${tokenKey}`;
        try {
          const usedRows = await sql.query(
            `INSERT INTO qr_token_uses (id, org_id, uid, token, token_key, valid_from, valid_until, used_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())
             ON CONFLICT (uid, token_key) DO NOTHING
             RETURNING id`,
            [useKey, organizationId, uid, payload.qrToken, tokenKey, v.validFrom, v.validUntil],
          );
          if (usedRows.length) qrPassed = true;
          else qrReason = 'qr_token_already_used';
        } catch {
          qrReason = 'qr_store_failed';
        }
      }
    }
    results.push({ name: 'qr', required: policy.requireQr, passed: qrPassed, reason: qrReason });
  }

  // --- Face ---
  let faceScore;
  if (features.verify.face) {
    let facePassed = false;
    let faceReason;
    if (!user.faceEmbeddingB64) {
      faceReason = 'face_not_enrolled';
    } else if (!payload.faceEmbeddingB64) {
      faceReason = 'missing_face_embedding';
    } else if (payload.faceLivenessOk === false) {
      faceReason = 'liveness_failed';
    } else {
      try {
        const candidate = decodeEmbedding(payload.faceEmbeddingB64);
        if (candidate.length !== FACE_EMBEDDING_DIM) {
          faceReason = 'bad_embedding_dim';
        } else {
          const score = cosineSimilarity(candidate, decodeEmbedding(user.faceEmbeddingB64));
          faceScore = score;
          if (score >= policy.faceThreshold) facePassed = true;
          else faceReason = 'similarity_below_threshold';
        }
      } catch (err) {
        faceReason = `embedding_decode_error:${err.message}`;
      }
    }
    results.push({
      name: 'face',
      required: policy.requireFace,
      passed: facePassed,
      reason: faceReason,
      details: { score: faceScore ?? null, threshold: policy.faceThreshold },
    });
  }

  // --- Device binding (anti buddy-punching) ---
  // When the client reports a deviceId, bind it to the first uid that uses it;
  // any other uid is rejected until an admin clears it. Always required.
  if (payload.deviceId) {
    let devicePassed = false;
    let deviceReason;
    try {
      const deviceRows = await sql.query(
        `INSERT INTO devices (device_id, org_id, uid, email, device_name, device_mac, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (device_id) DO UPDATE SET last_seen_at = now(), device_name = EXCLUDED.device_name
         WHERE devices.uid = EXCLUDED.uid
         RETURNING (xmax = 0) AS inserted`,
        [payload.deviceId, organizationId, uid, userEmail, payload.deviceName ?? null, payload.deviceMac ?? null],
      );
      if (!deviceRows.length) {
        deviceReason = 'device_bound_to_other_user';
      } else if (deviceRows[0].inserted) {
        devicePassed = true;
        deviceReason = 'device_bound';
      } else {
        devicePassed = true;
      }
    } catch {
      deviceReason = 'device_store_failed';
    }
    results.push({
      name: 'device',
      required: true,
      passed: devicePassed,
      reason: deviceReason,
      details: { deviceId: payload.deviceId, deviceName: payload.deviceName ?? null },
    });
  }

  let requiredFailed = results.filter((r) => r.required && !r.passed);
  const geoR = results.find((r) => r.name === 'geo');
  const ipR = results.find((r) => r.name === 'ip');
  if (payload.webDevice && (geoR || ipR) && (policy.requireGeo || policy.requireIp)) {
    // Device-adaptive WEB location (payload.webDevice derived from the User-Agent):
    //   - mobile web  → require BOTH geofence AND office-IP
    //   - desktop web → require office-IP only (desktops rarely have GPS)
    // Collapse geo/ip into a single 'location' verdict. If the IP gate isn't
    // configured (no ipR) we fall back to geo so we don't silently pass.
    requiredFailed = requiredFailed.filter((r) => r.name !== 'geo' && r.name !== 'ip');
    const locationOk = payload.webDevice === 'mobile'
      ? (ipR ? !!(geoR?.passed && ipR.passed) : !!geoR?.passed)
      : (ipR ? !!ipR.passed : !!geoR?.passed);
    if (!locationOk) requiredFailed.push({ name: 'location', required: true, passed: false });
  } else if (geoR && ipR && (geoR.required || ipR.required)) {
    // Fallback (no webDevice, e.g. the native app never sets it — though the app
    // has no ip result, so this branch is web-legacy only): original "geo OR ip".
    requiredFailed = requiredFailed.filter((r) => r.name !== 'geo' && r.name !== 'ip');
    if (!(geoR.passed || ipR.passed)) {
      requiredFailed.push({ name: 'location', required: true, passed: false });
    }
  }
  const allChecksPassed = requiredFailed.length === 0;

  const nowHhmm = bdHhmm();
  const scheduledStart = office.startTime;
  const scheduledEnd = office.endTime;
  const isLate = payload.type === 'CHECK_IN' && !!scheduledStart && nowHhmm > scheduledStart;
  const isEarly = payload.type === 'CHECK_OUT' && !!scheduledEnd && nowHhmm < scheduledEnd;

  const { text, params } = buildInsert('attendance_events', {
    orgId: organizationId,
    uid,
    userEmail,
    userName: user.name,
    officeId: office.id,
    type: payload.type,
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    accuracyMeters: payload.accuracyMeters ?? null,
    ssid: ssidNorm || null,
    bssid: bssidNorm || null,
    clientIp: payload.clientIp ?? null,
    faceMatchScore: faceScore ?? null,
    allChecksPassed,
    rawCheckResults: results,
    isLate,
    isEarly,
    scheduledStart: scheduledStart ?? null,
    scheduledEnd: scheduledEnd ?? null,
    clientMode: 'mobile',
    webDevice: payload.webDevice ?? null,
    apiKeyId: null,
    deviceId: payload.deviceId ?? null,
    deviceName: payload.deviceName ?? null,
  }, { jsonbKeys: ['rawCheckResults'], returning: 'id' });
  const eventRows = await sql.query(text, params);
  const eventId = eventRows[0].id;

  return {
    ok: allChecksPassed,
    eventId,
    results,
    faceMatchScore: faceScore ?? null,
    isLate,
    isEarly,
    scheduledStart: scheduledStart ?? null,
    scheduledEnd: scheduledEnd ?? null,
  };
}

// Manual attendance entry by a team lead / admin (no anti-cheat run). Counts as
// a valid event (allChecksPassed:true) and is tagged clientMode:'manual' +
// manualBy for audit. isLate/isEarly are derived from the office schedule —
// same rule as a real check-in — so it renders correctly in calendars/reports.
export async function addManualAttendance(orgId, { uid, type, atISO, note } = {}, actorUid) {
  if (type !== 'CHECK_IN' && type !== 'CHECK_OUT') throw Object.assign(new Error('type must be CHECK_IN or CHECK_OUT'), { status: 400 });
  const when = new Date(atISO);
  if (Number.isNaN(when.getTime())) throw Object.assign(new Error('invalid_timestamp'), { status: 400 });

  const [userRows, officeRows] = await Promise.all([
    sql`SELECT * FROM users WHERE firebase_uid = ${uid}`,
    sql`SELECT * FROM offices WHERE org_id = ${orgId} LIMIT 1`,
  ]);
  if (!userRows.length) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const u = rowToObject(userRows[0]);
  const office = officeRows.length ? rowToObject(officeRows[0]) : null;

  const hhmm = bdHhmm(when);
  const isLate = type === 'CHECK_IN' && !!office?.startTime && hhmm > office.startTime;
  const isEarly = type === 'CHECK_OUT' && !!office?.endTime && hhmm < office.endTime;

  const { text, params } = buildInsert('attendance_events', {
    orgId,
    uid,
    userEmail: u.email ?? '',
    userName: u.name ?? '',
    officeId: office?.id ?? null,
    type,
    timestamp: when,
    lat: null, lng: null, accuracyMeters: null,
    ssid: null, bssid: null, faceMatchScore: null,
    allChecksPassed: true,
    rawCheckResults: [],
    isLate, isEarly,
    scheduledStart: office?.startTime ?? null,
    scheduledEnd: office?.endTime ?? null,
    clientMode: 'manual',
    apiKeyId: null,
    deviceId: null,
    manualBy: actorUid ?? null,
    manualNote: note ?? null,
  }, { jsonbKeys: ['rawCheckResults'], returning: 'id' });
  const rows = await sql.query(text, params);
  return { id: rows[0].id, isLate, isEarly };
}

// Row → the nested-user row shape AttendDesk's external /attendance returns.
function mapEventRow(r) {
  return {
    id: r.id,
    user: { id: r.uid, email: r.user_email, name: r.user_name ?? r.user_email },
    type: r.type,
    timestamp: tsToIso(r.timestamp),
    allChecksPassed: r.all_checks_passed,
    clientMode: r.client_mode ?? 'mobile',
    apiKeyId: r.api_key_id ?? null,
    isLate: r.is_late ?? false,
    isEarly: r.is_early ?? false,
    scheduledStart: r.scheduled_start ?? null,
    scheduledEnd: r.scheduled_end ?? null,
  };
}

// History list. Server-side timestamp ORDER BY + optional same-field range and
// optional per-user scope, capped by LIMIT.
export async function listAttendance(organizationId, { from, to, userId, limit = 200 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const conds = ['org_id = $1'];
  const params = [organizationId];
  let i = 2;
  if (userId) { conds.push(`uid = $${i}`); params.push(userId); i++; }
  if (from) { conds.push(`timestamp >= $${i}`); params.push(new Date(from)); i++; }
  if (to) { conds.push(`timestamp <= $${i}`); params.push(new Date(to)); i++; }
  const text = `SELECT * FROM attendance_events WHERE ${conds.join(' AND ')} ORDER BY timestamp DESC LIMIT $${i}`;
  params.push(cap);
  const rows = await sql.query(text, params);
  return { events: rows.map(mapEventRow) };
}

// Mobile history for one uid → the app's HistoryEvent shape.
export async function listMyHistory(organizationId, uid, limit = 30) {
  const n = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const rows = await sql.query(
    `SELECT * FROM attendance_events WHERE org_id = $1 AND uid = $2 ORDER BY timestamp DESC LIMIT $3`,
    [organizationId, uid, n],
  );
  const events = rows.map((r) => ({
    id: r.id,
    type: r.type,
    timestamp: tsToIso(r.timestamp),
    allChecksPassed: r.all_checks_passed,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    ssid: r.ssid ?? null,
    faceMatchScore: r.face_match_score ?? null,
    isLate: r.is_late ?? false,
    isEarly: r.is_early ?? false,
    scheduledStart: r.scheduled_start ?? null,
    scheduledEnd: r.scheduled_end ?? null,
  }));
  return { events };
}
