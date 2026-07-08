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

function fmtLocation(r) {
  const place = (r.place || '').trim();
  const hasCoords = typeof r.lat === 'number' && typeof r.lng === 'number';
  if (place && hasCoords) return `${place} (${r.lat.toFixed(4)}, ${r.lng.toFixed(4)})`;
  if (place) return place;
  if (hasCoords) return `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`;
  return '—';
}

function fmtDur(mins) {
  if (typeof mins !== 'number' || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function fmtClock(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function RemoteApprovalsPanel() {
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
      const res = await apiFetch(`/api/admin/remote${qs}`, {
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
      const res = await fetch(`/api/admin/remote/${encodeURIComponent(id)}`, {
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

      {(() => {
        const approved = list.filter((r) => r.status === 'approved' && typeof r.durationMinutes === 'number');
        if (approved.length === 0) return null;
        const byUser = new Map();
        for (const r of approved) {
          const key = r.userName || r.userEmail || r.uid;
          byUser.set(key, (byUser.get(key) || 0) + r.durationMinutes);
        }
        const rows = [...byUser.entries()].sort((a, b) => b[1] - a[1]);
        const grand = approved.reduce((s, r) => s + r.durationMinutes, 0);
        return (
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm text-[var(--color-text-main)]">Approved remote hours</h3>
              <span className="text-xs text-[var(--color-text-muted)]">Total {fmtDur(grand)}</span>
            </div>
            <div className="flex flex-col gap-1">
              {rows.map(([name, mins]) => (
                <div key={name} className="flex justify-between text-sm">
                  <span className="text-[var(--color-text-main)]">{name}</span>
                  <span className="text-[var(--color-text-muted)]">{fmtDur(mins)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                <th className="py-3 px-4 font-medium">Employee</th>
                <th className="py-3 px-4 font-medium">Day</th>
                <th className="py-3 px-4 font-medium">Hours</th>
                <th className="py-3 px-4 font-medium">Reason</th>
                <th className="py-3 px-4 font-medium">Location</th>
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
                  <td className="py-3 px-4 text-[var(--color-text-main)] whitespace-nowrap">{r.day || '—'}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {r.status === 'working' ? (
                      <span className="text-[var(--color-yellow)]">Working…</span>
                    ) : r.durationMinutes != null ? (
                      <>
                        <div className="text-[var(--color-text-main)]">{fmtDur(r.durationMinutes)}</div>
                        {(fmtClock(r.startedAt) || fmtClock(r.endedAt)) && (
                          <div className="text-xs text-[var(--color-text-muted)]">{fmtClock(r.startedAt) || '—'}–{fmtClock(r.endedAt) || '…'}</div>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-[var(--color-text-main)] max-w-[260px]">{r.reason || '—'}</div>
                  </td>
                  <td className="py-3 px-4 text-[var(--color-text-muted)] max-w-[220px]">{fmtLocation(r)}</td>
                  <td className={`py-3 px-4 font-semibold capitalize ${STATUS_STYLE[r.status] || ''}`}>
                    {r.status}
                    {r.decisionNote && <div className="text-xs text-[var(--color-text-muted)] font-normal">{r.decisionNote}</div>}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {r.status === 'pending' ? (
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
                <tr><td colSpan={7} className="py-8 text-center text-[var(--color-text-muted)]">No {status === 'all' ? '' : status} requests.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={7} className="py-8 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
