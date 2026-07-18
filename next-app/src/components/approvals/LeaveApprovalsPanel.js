'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';

const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'cancelled', 'all'];
const STATUS_STYLE = {
  pending: 'text-[var(--color-yellow)]',
  approved: 'text-[var(--color-green)]',
  rejected: 'text-[var(--color-red)]',
  cancelled: 'text-[var(--color-text-muted)]',
};

function fmtRange(from, to) {
  if (!from) return '—';
  return from === to ? from : `${from} → ${to}`;
}

const HALF_LABEL = { first: 'First half', second: 'Second half' };
function leaveTypeLabel(r) {
  if (!r?.leaveType) return '';
  if (r.leaveType === 'Half Day' && r.halfDayPeriod) return `Half Day (${HALF_LABEL[r.halfDayPeriod] || r.halfDayPeriod})`;
  return r.leaveType;
}

export default function LeaveApprovalsPanel({ readOnly = false } = {}) {
  const [requests, setRequests] = useState(null);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const qs = status === 'all' ? '' : `?status=${status}`;
      const res = await apiFetch(`/api/admin/leave${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRequests(json.requests || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id, decision) => {
    const note = decision === 'rejected' ? prompt('Optional note for rejection:') || '' : '';
    setBusyId(id);
    setError('');
    setFeedback('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/leave/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decision, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback(`Request ${decision}.`);
      setTimeout(() => setFeedback(''), 3000);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  };

  const list = requests || [];

  return (
    <div className="flex flex-col gap-6">
      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <div className="card flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${
              status === s
                ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]'
                : 'btn-outline'
            }`}
          >
            {s}
          </button>
        ))}
        <button onClick={load} className="btn-outline py-1.5 px-3 text-xs ml-auto">Refresh</button>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                <th className="py-3 px-4 font-medium">Employee</th>
                <th className="py-3 px-4 font-medium">Dates</th>
                <th className="py-3 px-4 font-medium text-center">Days</th>
                <th className="py-3 px-4 font-medium">Details</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02] align-top">
                  <td className="py-3 px-4">
                    <div className="text-[var(--color-text-main)] font-medium">{r.userName || '—'}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{r.userEmail}</div>
                  </td>
                  <td className="py-3 px-4 text-[var(--color-text-main)] whitespace-nowrap">{fmtRange(r.fromDay, r.toDay)}</td>
                  <td className="py-3 px-4 text-center">{r.totalDays ?? '—'}</td>
                  <td className="py-3 px-4">
                    {r.leaveType && <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-purple)] mb-0.5">{leaveTypeLabel(r)}</div>}
                    {r.approvedBy && <div className="text-[var(--color-text-main)]">Approved by: {r.approvedBy}</div>}
                    {(r.department || r.lineManager) && (
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {[r.lineManager && `Manager: ${r.lineManager}`, r.department && `Dept: ${r.department}`].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {r.details && <div className="text-xs text-[var(--color-text-muted)] max-w-[260px]">{r.details}</div>}
                    {!r.approvedBy && !r.department && !r.lineManager && !r.details && <span className="text-[var(--color-text-muted)]">—</span>}
                  </td>
                  <td className={`py-3 px-4 font-semibold capitalize ${STATUS_STYLE[r.status] || ''}`}>
                    {r.status}
                    {r.decisionNote && <div className="text-xs text-[var(--color-text-muted)] font-normal">{r.decisionNote}</div>}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {!readOnly && r.status === 'pending' ? (
                      <div className="flex gap-2 justify-end">
                        <button
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'approved')}
                          className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(34,197,94,0.15)] text-[var(--color-green)] border border-[var(--color-green)] disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'rejected')}
                          className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(239,68,68,0.12)] text-[var(--color-red)] border border-[rgba(239,68,68,0.4)] disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && list.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">No {status === 'all' ? '' : status} requests.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
