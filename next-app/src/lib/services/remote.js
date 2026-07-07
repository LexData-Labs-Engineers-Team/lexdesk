import { firebaseAdmin, FieldValue } from '../firebase';
import { Paths } from '../paths';
import { createRequestService } from './requestKit';

// Remote WORK SESSION: an employee taps Start (reason + optional location) →
// status 'working' with startedAt; works; taps Done → endedAt + server-computed
// durationMinutes, status 'pending'. A team lead / admin then approves or rejects.
// Remote hours are a SEPARATE log — approval does NOT write attendance events
// (it no longer marks the day present).
//
// status lifecycle: working → pending → approved | rejected ; cancelled (from working/pending)

const svc = createRequestService({
  collection: (orgId) => Paths.remoteRequests(orgId),
  doc: (orgId, id) => Paths.remoteRequest(orgId, id),
  pick: (d) => ({
    day: d.day ?? '',
    reason: d.reason ?? '',
    place: d.place ?? '',
    lat: typeof d.lat === 'number' ? d.lat : null,
    lng: typeof d.lng === 'number' ? d.lng : null,
    startedAt: d.startedAt?.toDate?.()?.toISOString?.() ?? (typeof d.startedAt === 'string' ? d.startedAt : null),
    endedAt: d.endedAt?.toDate?.()?.toISOString?.() ?? (typeof d.endedAt === 'string' ? d.endedAt : null),
    durationMinutes: typeof d.durationMinutes === 'number' ? d.durationMinutes : null,
  }),
  build: () => ({}), // remote creates via startRemote below, not the generic submit
});

export const getRemoteRequests = (query, orgId) => svc.list(query, orgId);
export const listMyRemote = (orgId, uid) => svc.listMine(orgId, uid);
export const getRemote = (orgId, id) => svc.getOne(orgId, id);

// Office-tz (Asia/Dhaka) calendar day for stamping the session's day.
function todayDhaka() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// START a remote work session. One active ('working') session per user at a time.
// Exported as submitRemote too so the existing POST route keeps working.
export async function startRemote(body, orgId) {
  const { db } = firebaseAdmin();
  const uid = body.userId;
  const userSnap = await db.doc(Paths.user(orgId, uid)).get();
  if (!userSnap.exists) throw Object.assign(new Error('user_not_found'), { status: 404 });
  const u = userSnap.data();
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw Object.assign(new Error('reason_required'), { status: 400 });

  // Guard: block a second concurrent session. Single-field (uid) query → no
  // composite index; the per-user set is tiny, so filter status in memory.
  const mine = await db.collection(Paths.remoteRequests(orgId)).where('uid', '==', uid).get();
  if (mine.docs.some((doc) => doc.data()?.status === 'working')) {
    throw Object.assign(new Error('already_working'), { status: 409 });
  }

  const ref = await db.collection(Paths.remoteRequests(orgId)).add({
    uid,
    userEmail: u.email ?? '',
    userName: u.name || u.email || '',
    day: todayDhaka(),
    reason,
    place: String(body.place ?? '').trim(),
    lat: typeof body.lat === 'number' ? body.lat : null,
    lng: typeof body.lng === 'number' ? body.lng : null,
    status: 'working',
    startedAt: FieldValue.serverTimestamp(),
    endedAt: null,
    durationMinutes: null,
    createdAt: FieldValue.serverTimestamp(),
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
  });
  return { id: ref.id, status: 'working' };
}
export const submitRemote = (body, orgId) => startRemote(body, orgId);

// DONE — the owner ends their 'working' session. Duration is computed from the
// SERVER timestamps (never the client clock) and the session goes to 'pending'.
export async function doneRemote(orgId, uid, id) {
  const { db } = firebaseAdmin();
  const ref = db.doc(Paths.remoteRequest(orgId, id));
  const durationMinutes = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
    const d = snap.data() ?? {};
    if (String(d.uid) !== String(uid)) throw Object.assign(new Error('forbidden'), { status: 403 });
    if (d.status !== 'working') throw Object.assign(new Error('not_working'), { status: 409 });
    const startedMs = d.startedAt?.toDate?.()?.getTime?.() ?? null;
    const mins = startedMs ? Math.max(0, Math.round((Date.now() - startedMs) / 60000)) : 0;
    tx.update(ref, { status: 'pending', endedAt: FieldValue.serverTimestamp(), durationMinutes: mins });
    return mins;
  });
  return { ok: true, durationMinutes, request: svc.rowFromDoc(await ref.get()) };
}

// Owner cancels — allowed while 'working' (discard) or 'pending' (withdraw).
export async function cancelMyRemote(orgId, uid, id) {
  const { db } = firebaseAdmin();
  const ref = db.doc(Paths.remoteRequest(orgId, id));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
    const d = snap.data() ?? {};
    if (String(d.uid) !== String(uid)) throw Object.assign(new Error('forbidden'), { status: 403 });
    if (d.status !== 'working' && d.status !== 'pending') {
      throw Object.assign(new Error('not_cancellable'), { status: 409 });
    }
    tx.update(ref, { status: 'cancelled', decidedAt: FieldValue.serverTimestamp(), decidedBy: uid, decisionNote: null });
  });
  return { ok: true };
}

// Manager approve/reject of a completed (pending) session. Hours-log-only:
// this records the decision and does NOT write any attendance (present) events.
export async function decideRemote(id, decision, note, orgId, deciderUid) {
  return svc.decide(id, decision, note, orgId, deciderUid);
}
