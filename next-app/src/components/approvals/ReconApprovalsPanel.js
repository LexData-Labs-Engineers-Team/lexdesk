'use client';

import { useEffect, useState, useCallback } from 'react';

const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'cancelled', 'all'];
const STATUS_STYLE = {
  pending: 'text-[var(--color-yellow)]',
  approved: 'text-[var(--color-green)]',
  rejected: 'text-[var(--color-red)]',
  cancelled: 'text-[var(--color-text-muted)]',
};
function fmtTime(iso) {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}+06:00`;
  const d = new Date(s);
  return isNaN(d) ? null : new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}
function proposed(r) {
  return [fmtTime(r.proposedInIso) && `in ${fmtTime(r.proposedInIso)}`, fmtTime(r.proposedOutIso) && `out ${fmtTime(r.proposedOutIso)}`].filter(Boolean).join(' · ') || '—';
}

export default function ReconApprovalsPanel() {
  const [requests, setRequests] = useState(null);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [feedback, setFeedback] = useState('');
  // System admin can delete recon logs. Lazy init (no set-state-in-effect).
  const [isSuper] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'superadmin'; } catch { return false; }
  });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = localStorage.getItem('token');
      const qs = status === 'all' ? '' : `?status=${status}`;
      const res = await fetch(`/api/admin/recon${qs}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRequests(json.requests || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id, decision) => {
    const note = decision === 'rejected' ? prompt('Optional note for rejection:') || '' : '';
    setBusyId(id); setError(''); setFeedback('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/recon/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decision, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback(`Reconciliation ${decision}${decision === 'approved' ? ' — attendance updated' : ''}.`); setTimeout(() => setFeedback(''), 3500);
      await load();
    } catch (e) { setError(e.message); } finally { setBusyId(''); }
  };

  const remove = async (id) => {
    if (!window.confirm('Permanently delete this reconciliation log? Any attendance already applied on approval is kept.')) return;
    setBusyId(id); setError(''); setFeedback('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/recon/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback('Reconciliation log deleted.'); setTimeout(() => setFeedback(''), 3000);
      await load();
    } catch (e) { setError(e.message); } finally { setBusyId(''); }
  };

  const list = requests || [];
  return (
    <div className="flex flex-col gap-6">
      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}
      <div className="card flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${status === s ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>{s}</button>
        ))}
        <button onClick={load} className="btn-outline py-1.5 px-3 text-xs ml-auto">Refresh</button>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
              <th className="py-3 px-4 font-medium">Employee</th><th className="py-3 px-4 font-medium">Day</th><th className="py-3 px-4 font-medium">Proposed in/out</th><th className="py-3 px-4 font-medium">Reason</th><th className="py-3 px-4 font-medium">Status</th><th className="py-3 px-4 font-medium text-right">Action</th>
            </tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02] align-top">
                  <td className="py-3 px-4"><div className="text-[var(--color-text-main)] font-medium">{r.userName || '—'}</div><div className="text-xs text-[var(--color-text-muted)]">{r.userEmail}</div></td>
                  <td className="py-3 px-4 text-[var(--color-text-main)] whitespace-nowrap">{r.day || '—'}</td>
                  <td className="py-3 px-4 text-[var(--color-text-main)] whitespace-nowrap">{proposed(r)}</td>
                  <td className="py-3 px-4 text-[var(--color-text-muted)] max-w-[240px]">{r.reason || '—'}</td>
                  <td className={`py-3 px-4 font-semibold capitalize ${STATUS_STYLE[r.status] || ''}`}>{r.status}{r.decisionNote && <div className="text-xs text-[var(--color-text-muted)] font-normal">{r.decisionNote}</div>}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="flex gap-2 justify-end">
                      {r.status === 'pending' && (
                        <>
                          <button disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(34,197,94,0.15)] text-[var(--color-green)] border border-[var(--color-green)] disabled:opacity-50">Approve</button>
                          <button disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(239,68,68,0.12)] text-[var(--color-red)] border border-[rgba(239,68,68,0.4)] disabled:opacity-50">Reject</button>
                        </>
                      )}
                      {isSuper && (
                        <button disabled={busyId === r.id} onClick={() => remove(r.id)} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(239,68,68,0.12)] text-[var(--color-red)] border border-[rgba(239,68,68,0.4)] disabled:opacity-50">Delete</button>
                      )}
                      {r.status !== 'pending' && !isSuper && <span className="text-xs text-[var(--color-text-muted)]">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && list.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">No {status === 'all' ? '' : status} requests.</td></tr>}
              {loading && <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
