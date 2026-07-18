'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { apiFetch } from '@/lib/apiFetch';

const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'all'];
const STATUS_STYLE = {
  pending: 'text-[var(--color-yellow)]',
  approved: 'text-[var(--color-green)]',
  rejected: 'text-[var(--color-red)]',
  cancelled: 'text-[var(--color-text-muted)]',
};

const fmtRange = (from, to) => (!from ? '—' : from === to ? from : `${from} → ${to}`);
function fmtTime(iso) {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}+06:00`;
  const d = new Date(s);
  return isNaN(d) ? null : new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}
const reconProposed = (r) => [fmtTime(r.proposedInIso) && `in ${fmtTime(r.proposedInIso)}`, fmtTime(r.proposedOutIso) && `out ${fmtTime(r.proposedOutIso)}`].filter(Boolean).join(' · ') || '—';

const HALF_LABEL = { first: 'First half', second: 'Second half' };
const leaveTypeLabel = (r) =>
  !r?.leaveType ? '' : r.leaveType === 'Half Day' && r.halfDayPeriod ? `Half Day (${HALF_LABEL[r.halfDayPeriod] || r.halfDayPeriod})` : r.leaveType;

// Per-module column config so all six request types share one table.
const MODES = [
  { key: 'leave', label: 'Leave', h1: 'Dates', h2: 'Approved by', c1: (r) => fmtRange(r.fromDay, r.toDay), c1sub: (r) => leaveTypeLabel(r), c2: (r) => r.approvedBy || '—', c2sub: (r) => [r.lineManager && `Manager: ${r.lineManager}`, r.department && `Dept: ${r.department}`, r.details].filter(Boolean).join(' · ') },
  { key: 'asset', label: 'Assets', h1: 'Asset', h2: 'Dates', c1: (r) => r.assetName || '—', c1sub: (r) => [r.assetType, r.description].filter(Boolean).join(' · '), c2: (r) => fmtRange(r.fromDay, r.toDay) },
  { key: 'recon', label: 'Recon', h1: 'Day', h2: 'Reason', c1: (r) => r.day || '—', c2: (r) => r.reason || '—', c2sub: (r) => reconProposed(r) },
  { key: 'remote', label: 'Remote', h1: 'Day', h2: 'Reason', c1: (r) => r.day || '—', c2: (r) => r.reason || '—', c2sub: (r) => r.place },
];

export default function TeamApprovalsPage() {
  const [mode, setMode] = useState('leave');
  const [requests, setRequests] = useState(null);
  const [isLeader, setIsLeader] = useState(true);
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
      const res = await apiFetch(`/api/team/${mode}${qs}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRequests(json.requests || []);
      setIsLeader(json.isLeader !== false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status, mode]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, decision) => {
    let note = '';
    if (decision === 'rejected') {
      const r = prompt('Optional note for rejection:');
      if (r === null) return;
      note = r;
    }
    setBusyId(id);
    setError('');
    setFeedback('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/team/${mode}/${encodeURIComponent(id)}`, {
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
  const cfg = MODES.find((m) => m.key === mode) || MODES[0];
  const isAsset = mode === 'asset';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team Approvals"
        subtitle="Review and decide your team's requests"
        actions={<button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>}
      />

      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      {!loading && !isLeader ? (
        <div className="card text-[var(--color-text-muted)] text-sm text-center py-12">
          You don’t lead a team yet. When an admin makes you a team leader, your team’s requests appear here.
        </div>
      ) : (
        <>
          <div className="card flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button key={m.key} onClick={() => setMode(m.key)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${mode === m.key ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>{m.label}</button>
              ))}
            </div>
            <div className="h-5 w-px bg-[var(--color-card-border)]" />
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((s) => (
                <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${status === s ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>{s}</button>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                    <th className="py-3 px-4 font-medium">Employee</th>
                    <th className="py-3 px-4 font-medium">{cfg.h1}</th>
                    <th className="py-3 px-4 font-medium">{cfg.h2}</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    // Asset: the lead acts only while the lead side is still pending.
                    const canAct = isAsset ? (r.status === 'pending' && r.leadStatus === 'pending') : (r.status === 'pending');
                    const c1sub = cfg.c1sub ? cfg.c1sub(r) : '';
                    const c2sub = cfg.c2sub ? cfg.c2sub(r) : '';
                    return (
                      <tr key={r.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02] align-top">
                        <td className="py-3 px-4">
                          <div className="text-[var(--color-text-main)] font-medium">{r.userName || '—'}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{r.userEmail}</div>
                        </td>
                        <td className="py-3 px-4 text-[var(--color-text-main)] whitespace-nowrap">
                          {cfg.c1(r)}
                          {c1sub ? <div className="text-xs text-[var(--color-text-muted)]">{c1sub}</div> : null}
                        </td>
                        <td className="py-3 px-4 text-[var(--color-text-main)]">
                          <div className="max-w-[280px]">{cfg.c2(r)}</div>
                          {c2sub ? <div className="text-xs text-[var(--color-text-muted)] max-w-[280px]">{c2sub}</div> : null}
                        </td>
                        <td className="py-3 px-4">
                          <div className={`font-semibold capitalize ${STATUS_STYLE[r.status] || ''}`}>{r.status}</div>
                          {isAsset && (
                            <div className="text-[11px] text-[var(--color-text-muted)]">
                              Lead: <span className="capitalize">{r.leadStatus}</span> · Admin: <span className="capitalize">{r.adminStatus}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {canAct ? (
                            <div className="flex gap-2 justify-end">
                              <button disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(34,197,94,0.15)] text-[var(--color-green)] border border-[var(--color-green)] disabled:opacity-50">Approve</button>
                              <button disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(239,68,68,0.12)] text-[var(--color-red)] border border-[rgba(239,68,68,0.4)] disabled:opacity-50">Reject</button>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && list.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-[var(--color-text-muted)]">No {status === 'all' ? '' : status} {mode} requests for your team.</td></tr>
                  )}
                  {loading && (
                    <tr><td colSpan={5} className="py-8 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
