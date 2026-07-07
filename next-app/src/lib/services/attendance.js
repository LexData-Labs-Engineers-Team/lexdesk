import crypto from 'node:crypto';
import { firebaseAdmin, FieldValue } from '../firebase';
import { Paths } from '../paths';
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
  const { db } = firebaseAdmin();

  const [policySnap, officesSnap, userSnap, features] = await Promise.all([
    db.doc(Paths.policy(organizationId)).get(),
    db.collection(Paths.offices(organizationId)).limit(1).get(),
    db.doc(Paths.user(organizationId, uid)).get(),
    getFeatures(organizationId),
  ]);

  if (!policySnap.exists) throw Object.assign(new Error('policy_not_configured'), { status: 404 });
  if (officesSnap.empty) throw Object.assign(new Error('office_not_configured'), { status: 404 });
  if (!userSnap.exists) throw Object.assign(new Error('user_not_found'), { status: 404 });

  const policy = policySnap.data();
  const officeDoc = officesSnap.docs[0];
  const office = { id: officeDoc.id, ...officeDoc.data() };
  const user = userSnap.data();

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
        const useKey = `${uid}_${hashTokenForKey(payload.qrToken, organizationId)}`;
        const useRef = db.doc(Paths.qrTokenUse(organizationId, useKey));
        try {
          await useRef.create({
            uid,
            token: payload.qrToken,
            validFrom: v.validFrom,
            validUntil: v.validUntil,
            usedAt: FieldValue.serverTimestamp(),
          });
          qrPassed = true;
        } catch (err) {
          const code = err?.code;
          qrReason = code === 6 || code === 'already-exists' ? 'qr_token_already_used' : 'qr_store_failed';
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
    const deviceRef = db.doc(Paths.device(organizationId, payload.deviceId));
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(deviceRef);
        if (!snap.exists) {
          tx.set(deviceRef, {
            uid,
            email: userEmail,
            deviceName: payload.deviceName ?? null,
            deviceMac: payload.deviceMac ?? null,
            firstSeenAt: FieldValue.serverTimestamp(),
            lastSeenAt: FieldValue.serverTimestamp(),
          });
          devicePassed = true;
          deviceReason = 'device_bound';
          return;
        }
        if (snap.data()?.uid === uid) {
          tx.update(deviceRef, { lastSeenAt: FieldValue.serverTimestamp(), deviceName: payload.deviceName ?? null });
          devicePassed = true;
        } else {
          deviceReason = 'device_bound_to_other_user';
        }
      });
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

  const eventRef = db.collection(Paths.events(organizationId)).doc();
  await eventRef.set({
    uid,
    userEmail,
    userName: user.name,
    officeId: office.id,
    type: payload.type,
    timestamp: FieldValue.serverTimestamp(),
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
  });

  return {
    ok: allChecksPassed,
    eventId: eventRef.id,
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

  const { db } = firebaseAdmin();
  const [userSnap, officesSnap] = await Promise.all([
    db.doc(Paths.user(orgId, uid)).get(),
    db.collection(Paths.offices(orgId)).limit(1).get(),
  ]);
  if (!userSnap.exists) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const u = userSnap.data();
  const office = officesSnap.empty ? null : { id: officesSnap.docs[0].id, ...officesSnap.docs[0].data() };

  const hhmm = bdHhmm(when);
  const isLate = type === 'CHECK_IN' && !!office?.startTime && hhmm > office.startTime;
  const isEarly = type === 'CHECK_OUT' && !!office?.endTime && hhmm < office.endTime;

  const ref = db.collection(Paths.events(orgId)).doc();
  await ref.set({
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
  });
  return { id: ref.id, isLate, isEarly };
}

// Doc → the nested-user row shape AttendDesk's external /attendance returns.
function mapEventDoc(d) {
  const data = d.data();
  return {
    id: d.id,
    user: { id: data.uid, email: data.userEmail, name: data.userName ?? data.userEmail },
    type: data.type,
    timestamp: data.timestamp?.toDate?.()?.toISOString() ?? null,
    allChecksPassed: data.allChecksPassed,
    clientMode: data.clientMode ?? 'mobile',
    apiKeyId: data.apiKeyId ?? null,
    isLate: data.isLate ?? false,
    isEarly: data.isEarly ?? false,
    scheduledStart: data.scheduledStart ?? null,
    scheduledEnd: data.scheduledEnd ?? null,
  };
}

// History list. When scoped to ONE user we use an equality-only query (no
// composite index) and sort/filter/slice client-side — mirrors listMyHistory.
// The org-wide path keeps the server-side timestamp orderBy (+ same-field range),
// which only needs the automatic single-field index.
export async function listAttendance(organizationId, { from, to, userId, limit = 200 } = {}) {
  const { db } = firebaseAdmin();
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const col = db.collection(Paths.events(organizationId));

  if (userId) {
    const snap = await col.where('uid', '==', userId).get();
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() : null;
    const events = snap.docs
      .map(mapEventDoc)
      .filter((e) => {
        if (!e.timestamp) return false;
        const t = new Date(e.timestamp).getTime();
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
        return true;
      })
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      .slice(0, cap);
    return { events };
  }

  let query = col;
  if (from) query = query.where('timestamp', '>=', new Date(from));
  if (to) query = query.where('timestamp', '<=', new Date(to));
  query = query.orderBy('timestamp', 'desc').limit(cap);
  const snap = await query.get();
  return { events: snap.docs.map(mapEventDoc) };
}

// Mobile history for one uid → the app's HistoryEvent shape. Uses an
// equality-only query (no Firestore composite index needed) then sorts +
// slices client-side.
export async function listMyHistory(organizationId, uid, limit = 30) {
  const { db } = firebaseAdmin();
  const snap = await db.collection(Paths.events(organizationId)).where('uid', '==', uid).get();
  const n = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const events = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        timestamp: data.timestamp?.toDate?.()?.toISOString() ?? null,
        allChecksPassed: data.allChecksPassed,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        ssid: data.ssid ?? null,
        faceMatchScore: data.faceMatchScore ?? null,
        isLate: data.isLate ?? false,
        isEarly: data.isEarly ?? false,
        scheduledStart: data.scheduledStart ?? null,
        scheduledEnd: data.scheduledEnd ?? null,
      };
    })
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, n);
  return { events };
}
