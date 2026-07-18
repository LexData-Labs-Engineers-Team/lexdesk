'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// Loaded on demand only — pulls the webcam + ML pipeline, which must never
// weigh down the dashboard bundle.
const FaceCaptureModal = dynamic(() => import('./FaceCaptureModal'), { ssr: false });

// AttendDesk failure reasons → friendly text. Unknown reasons fall through raw
// so new upstream checks still surface something meaningful.
const REASON_TEXT = {
  ssid_and_bssid_not_in_allowlist: 'Not on an approved office Wi-Fi network — use the mobile app',
  mock_location: 'Mock location detected',
  missing_location: 'No location was provided',
  low_accuracy: 'GPS accuracy too low — desktop browsers often only get ~500 m; try a phone browser',
  outside_geofence: "You're outside the office area",
  missing_qr_token: 'QR scan required — use the mobile app',
  invalid_qr_token: 'QR code invalid or expired — use the mobile app',
  qr_token_already_used: 'QR code already used — use the mobile app',
  face_not_enrolled: 'Face not enrolled — use Enroll face below',
  missing_face_embedding: 'Face verification required — click Verify face',
  liveness_failed: 'Face liveness check failed — try again',
  similarity_below_threshold: "Face didn't match — try again with better lighting",
  bad_embedding_dim: 'Face data mismatch — re-enroll required',
  ip_not_in_allowlist: 'Not on the office network — check in from the office',
  office_ip_not_configured: 'Office IP allowlist is empty — ask your admin to set it',
  missing_ip: 'Could not determine your network IP',
};

// Captured face embeddings are valid this long before re-verification
// (mirrors the Android app's 60 s freshness window).
const FACE_TTL_MS = 60_000;

const CHECK_LABEL = { wifi: 'Wi-Fi', geo: 'Location', qr: 'QR code', face: 'Face', ip: 'Office network' };

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

function timeFmt(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
  } catch {
    return '—';
  }
}

// `bare` drops the .card wrapper so the caller can embed the check-in UI inside
// another card. `title` sets the section heading; pass null to hide it (e.g.
// when the embedding card already has its own title).
export default function CheckInCard({ onSuccess, todayIn, todayOut, bare = false, title = 'Verify & Check In' }) {
  const [phase, setPhase] = useState('idle'); // idle | locating | submitting
  const [info, setInfo] = useState(null); // { policy, office } — pre-warnings only, non-fatal if missing
  const [result, setResult] = useState(null); // last check-in response + { type, dist }
  const [error, setError] = useState('');
  const [faceEnrolledAt, setFaceEnrolledAt] = useState(null);
  const [face, setFace] = useState(null); // { b64, at } — fresh capture, 60 s TTL
  const [modal, setModal] = useState(null); // null | 'verify' | 'enroll'
  const [pendingType, setPendingType] = useState(null); // submit to resume after verify

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/me/policy', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && res.ok) setInfo(json);
      } catch {
        // ignore — the card still works, just without pre-warnings
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Face is browser-supported now; only WiFi (impossible in browsers) and QR
  // remain mobile-only.
  const mobileOnly = [
    info?.policy?.requireWifi && 'Wi-Fi',
    info?.policy?.requireQr && 'QR',
  ].filter(Boolean);

  const requireFace = !!info?.policy?.requireFace;

  // Enrollment status drives which face button to show; fetched only when the
  // org actually requires the face check.
  useEffect(() => {
    if (!requireFace) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/me/profile', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && res.ok) setFaceEnrolledAt(json?.profile?.faceEnrolledAt ?? null);
      } catch {
        // non-fatal — worst case the user sees Verify instead of Enroll and
        // the server replies face_not_enrolled
      }
    })();
    return () => { cancelled = true; };
  }, [requireFace]);

  const freshFaceB64 = (override) => {
    if (override) return override;
    if (face && Date.now() - face.at < FACE_TTL_MS) return face.b64;
    return null;
  };

  async function submit(type, faceOverride) {
    setError('');
    setResult(null);
    // Face gate first (before spending time on a GPS fix): enrolled users with
    // no fresh capture verify their face, then submit resumes automatically.
    // Un-enrolled users aren't blocked — the server's face_not_enrolled result
    // plus the Enroll button below tell them what to do.
    const faceB64 = freshFaceB64(faceOverride);
    if (requireFace && faceEnrolledAt && !faceB64) {
      setPendingType(type);
      setModal('verify');
      return;
    }
    setPhase('locating');
    // GPS is best-effort: if the browser can't get a fix (permission denied,
    // unavailable, insecure context), we still submit and let the office-IP
    // check carry the location requirement server-side. If both the geofence
    // and the office-IP fail, the server reports it per-check below.
    let coords = null;
    if ('geolocation' in navigator && window.isSecureContext !== false) {
      try {
        coords = (await getPosition()).coords;
      } catch {
        coords = null;
      }
    }
    setPhase('submitting');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/me/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type,
          ...(coords ? { lat: coords.latitude, lng: coords.longitude, accuracyMeters: coords.accuracy } : {}),
          ...(faceB64 ? { faceEmbeddingB64: faceB64 } : {}),
        }),
      });
      if (res.status === 401) {
        setError('Session expired — please sign in again.');
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      const dist =
        coords && info?.office?.lat != null && info?.office?.lng != null
          ? distanceMeters(coords.latitude, coords.longitude, info.office.lat, info.office.lng)
          : null;
      setResult({ ...json, type, dist });
      // A capture that failed the server-side match can never succeed — drop
      // it so the Verify button returns, instead of resending the identical
      // embedding from cache for the rest of its 60 s TTL.
      const faceCheck = (json.results || []).find((r) => r.name === 'face');
      if (faceCheck && faceCheck.passed === false) setFace(null);
      if (json.ok) onSuccess?.();
    } catch (e) {
      setError(e.message || 'Network error');
    } finally {
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';

  return (
    <div className={`${bare ? '' : 'card '}flex flex-col gap-3`}>
      <div>
        {title && <h2 className="text-base font-semibold text-[var(--color-text-main)]">{title}</h2>}
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Location-verified from your browser
          {info?.policy?.gpsAccuracyMaxMeters ? ` · GPS accuracy ≤ ${info.policy.gpsAccuracyMaxMeters} m` : ''}
        </p>
        {(todayIn || todayOut) && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Today: in {todayIn ? timeFmt(todayIn) : '—'} · out {todayOut ? timeFmt(todayOut) : '—'}
          </p>
        )}
      </div>

      {mobileOnly.length > 0 && (
        <div className="text-xs rounded-lg border border-[rgba(234,179,8,0.35)] bg-[rgba(234,179,8,0.08)] text-[var(--color-yellow)] px-3 py-2">
          Your organization requires {mobileOnly.join(', ')} verification, which only works in the
          mobile app — browser check-in will fail until done there.
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => submit('CHECK_IN')}
          disabled={busy}
          className="btn-primary py-2 px-4 text-sm flex-1 disabled:opacity-60"
        >
          {phase === 'locating' ? 'Getting location…' : phase === 'submitting' ? 'Submitting…' : 'Check In'}
        </button>
        <button
          onClick={() => submit('CHECK_OUT')}
          disabled={busy}
          className="btn-outline py-2 px-4 text-sm flex-1 disabled:opacity-60"
        >
          Check Out
        </button>
      </div>

      {requireFace && (
        <div className="flex items-center justify-between gap-2 text-xs">
          {!faceEnrolledAt ? (
            <>
              <span className="text-[var(--color-text-muted)]">Face check required — enroll once to enable it (your admin can reset it later).</span>
              <button onClick={() => setModal('enroll')} disabled={busy} className="btn-outline py-1.5 px-3 text-xs shrink-0">Enroll face</button>
            </>
          ) : freshFaceB64() ? (
            // "captured", not "verified" — matching happens server-side at submit
            <span className="text-[var(--color-green)]">Face captured ✓ — valid for the next minute</span>
          ) : (
            <>
              <span className="text-[var(--color-text-muted)]">Face check required — verify before checking in.</span>
              <button onClick={() => setModal('verify')} disabled={busy} className="btn-outline py-1.5 px-3 text-xs shrink-0">Verify face</button>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-red)]">{error}</p>}

      {result && (
        <div className="flex flex-col gap-2 text-sm">
          <p className={`font-semibold ${result.ok ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}`}>
            {result.ok
              ? result.type === 'CHECK_IN' ? 'Checked in ✓' : 'Checked out ✓'
              : result.type === 'CHECK_IN' ? 'Check-in failed' : 'Check-out failed'}
            {result.dist != null && (
              <span className="font-normal text-[var(--color-text-muted)]">
                {' '}· ~{result.dist} m from {info?.office?.name || 'office'}
              </span>
            )}
          </p>
          {result.isLate && (
            <p className="text-xs text-[var(--color-yellow)]">Marked late — office starts at {result.scheduledStart}</p>
          )}
          {result.isEarly && (
            <p className="text-xs text-[var(--color-yellow)]">Early checkout — office ends at {result.scheduledEnd}</p>
          )}
          <div className="flex flex-col gap-1">
            {(result.results || []).map((r) => (
              <div key={r.name} className="flex items-start gap-2">
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                    r.passed ? 'bg-[var(--color-green)]' : r.required ? 'bg-[var(--color-red)]' : 'bg-[var(--color-text-muted)]'
                  }`}
                />
                <span className="text-xs text-[var(--color-text-main)]">
                  {CHECK_LABEL[r.name] || r.name}
                  {!r.passed && r.reason ? (
                    <span className="text-[var(--color-text-muted)]"> — {REASON_TEXT[r.reason] || r.reason}</span>
                  ) : null}
                  {r.name === 'face' && r.details?.score != null && localStorage.getItem('lexdesk:faceDebug') === '1' ? (
                    <span className="text-[var(--color-text-muted)]"> · match {Number(r.details.score).toFixed(2)} / {r.details.threshold}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal && (
        <FaceCaptureModal
          mode={modal}
          onClose={() => { setModal(null); setPendingType(null); }}
          onDone={({ b64, enrolledAt }) => {
            setModal(null);
            if (b64) {
              // Verified: stash the capture and resume the submit that
              // triggered the modal (state may not have flushed — pass b64).
              setFace({ b64, at: Date.now() });
              const t = pendingType;
              setPendingType(null);
              if (t) submit(t, b64);
            } else if (enrolledAt) {
              setFaceEnrolledAt(enrolledAt);
            }
          }}
        />
      )}
    </div>
  );
}
