import { sql } from '../db';
import { createRequestService, ISO_DAY_RE } from './requestKit';
import { addManualAttendance } from './attendance';

// Attendance reconciliation — employee proposes a corrected in/out for a day
// with a reason; a manager approves/rejects. On APPROVAL we write the proposed
// time(s) as manual attendance events (additive, non-destructive — the canonical
// earliest-in/latest-out absorbs the correction; real events are never deleted).

// Treat a bare "YYYY-MM-DDTHH:mm:ss" (no zone) as Asia/Dhaka (+06:00).
function dhakaIso(s) {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+06:00`;
}

const svc = createRequestService({
  table: 'recon_requests',
  pick: (d) => ({
    day: d.day ?? '',
    proposedInIso: d.proposed_in_iso ?? null,
    proposedOutIso: d.proposed_out_iso ?? null,
    reason: d.reason ?? '',
  }),
  build: (b) => {
    if (!ISO_DAY_RE.test(b.day ?? '')) throw Object.assign(new Error('invalid_day'), { status: 400 });
    const reason = String(b.reason ?? '').trim();
    if (!reason) throw Object.assign(new Error('reason_required'), { status: 400 });
    if (!b.proposedInIso && !b.proposedOutIso) {
      throw Object.assign(new Error('proposed_time_required'), { status: 400 });
    }
    return {
      day: b.day,
      proposedInIso: b.proposedInIso ? String(b.proposedInIso) : null,
      proposedOutIso: b.proposedOutIso ? String(b.proposedOutIso) : null,
      reason,
    };
  },
});

export const getReconRequests = (query, orgId) => svc.list(query, orgId);
export const listMyRecon = (orgId, uid) => svc.listMine(orgId, uid);
export const submitRecon = (body, orgId) => svc.submit(body, orgId);
export const cancelMyRecon = (orgId, uid, id) => svc.cancelMine(orgId, uid, id);
export async function decideRecon(id, decision, note, orgId, deciderUid) {
  const result = await svc.decide(id, decision, note, orgId, deciderUid);
  if (decision === 'approved' && result?.request) {
    const r = result.request;
    if (r.proposedInIso) {
      await addManualAttendance(orgId, { uid: r.uid, type: 'CHECK_IN', atISO: dhakaIso(r.proposedInIso), note: `Reconciliation ${id}` }, deciderUid);
    }
    if (r.proposedOutIso) {
      await addManualAttendance(orgId, { uid: r.uid, type: 'CHECK_OUT', atISO: dhakaIso(r.proposedOutIso), note: `Reconciliation ${id}` }, deciderUid);
    }
  }
  return result;
}
export const getRecon = (orgId, id) => svc.getOne(orgId, id);

// System-admin cleanup: permanently delete a reconciliation record. Log only —
// any manual attendance the approval already wrote is intentionally left intact.
export async function deleteRecon(orgId, id) {
  const rows = await sql`DELETE FROM recon_requests WHERE id=${id} AND org_id=${orgId} RETURNING id`;
  if (!rows.length) throw Object.assign(new Error('not_found'), { status: 404 });
  return { ok: true };
}
