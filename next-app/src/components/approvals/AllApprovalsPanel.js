'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'];
const STATUS_STYLE = {
  pending: 'text-[var(--color-yellow)]',
  approved: 'text-[var(--color-green)]',
  rejected: 'text-[var(--color-red)]',
  cancelled: 'text-[var(--color-text-muted)]',
  working: 'text-[var(--color-yellow)]',
};

// ── formatting helpers (ported from the per-type panels) ────────────────────
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
function fmtLocation(r) {
  const place = (r.place || '').trim();
  const hasCoords = typeof r.lat === 'number' && typeof r.lng === 'number';
  if (place && hasCoords) return `${place} (${r.lat.toFixed(4)}, ${r.lng.toFixed(4)})`;
  if (place) return place;
  if (hasCoords) return `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`;
  return '—';
}
function fmtReconTime(iso) {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}+06:00`;
  const d = new Date(s);
  return isNaN(d) ? null : new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}
function reconProposed(r) {
  return [fmtReconTime(r.proposedInIso) && `in ${fmtReconTime(r.proposedInIso)}`, fmtReconTime(r.proposedOutIso) && `out ${fmtReconTime(r.proposedOutIso)}`]
    .filter(Boolean).join(' · ') || '—';
}

const Muted = ({ children }) => <div className="text-xs text-[var(--color-text-muted)]">{children}</div>;

// Small fact chip (days, leave type, etc.) — keeps the structured bits visually
// separate from the free-text message below them.
const Chip = ({ children, color }) => (
  <span
    className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
    style={{ color: color || 'var(--color-text-main)', background: 'rgba(150,150,150,0.12)' }}
  >
    {children}
  </span>
);

// Long free-text (leave reason, asset description, …) clamped to 2 lines with a
// Show more / less toggle so a wordy request can't blow up the row height.
function ClampText({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const clamp = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  return (
    <div className="text-xs text-[var(--color-text-muted)] max-w-[340px]">
      <p style={open ? undefined : clamp}>{text}</p>
      {text.length > 90 && (
        <button onClick={() => setOpen((o) => !o)} className="mt-0.5 font-semibold text-[var(--color-purple)]">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// Each approval type: which roles may see it, its API base, badge color, and how
// to render its "When"/"Details" cells + whether a pending row is decidable.
const SOURCES = [
  {
    type: 'Leave', base: '/api/admin/leave', color: 'var(--color-purple)',
    roles: ['admin', 'superadmin', 'it_team'],
    when: (r) => fmtRange(r.fromDay, r.toDay),
    canDecide: (r) => r.status === 'pending',
    // Half-day leaves get their own badge so full-day vs half-day read apart.
    badge: (r) => (r.leaveType === 'Half Day'
      ? { label: 'Half Day Leave', color: 'var(--color-pink)' }
      : { label: 'Leave', color: 'var(--color-purple)' }),
    reason: (r) => r.details,
    details: (r) => (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip color="var(--color-text-main)">{r.totalDays ?? '—'} day{r.totalDays === 1 ? '' : 's'}</Chip>
          {leaveTypeLabel(r) && <Chip color="var(--color-purple)">{leaveTypeLabel(r)}</Chip>}
        </div>
        {r.lineManager && <Muted>Manager: {r.lineManager}</Muted>}
      </div>
    ),
  },
  {
    type: 'Asset', base: '/api/admin/asset', color: 'var(--color-blue)',
    roles: ['admin', 'superadmin', 'it_team'],
    when: (r) => fmtRange(r.fromDay, r.toDay),
    canDecide: (r) => r.status === 'pending' && r.adminStatus === 'pending',
    reason: (r) => r.description,
    details: (r) => (
      <div className="flex flex-col gap-1.5">
        <div className="text-[var(--color-text-main)]">{r.assetName || '—'}{r.assetType ? ` · ${r.assetType}` : ''}</div>
        <Muted>Lead: {r.requiresLead ? (r.leadStatus || 'pending') : 'n/a'} · Admin: {r.adminStatus || 'pending'}</Muted>
      </div>
    ),
  },
  {
    type: 'Remote', base: '/api/admin/remote', color: 'var(--color-green)',
    roles: ['admin', 'superadmin'],
    when: (r) => r.day || '—',
    canDecide: (r) => r.status === 'pending',
    reason: (r) => r.reason,
    details: (r) => (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip color="var(--color-text-main)">{r.status === 'working' ? 'Working…' : fmtDur(r.durationMinutes)}</Chip>
          {(fmtClock(r.startedAt) || fmtClock(r.endedAt)) && <Chip>{fmtClock(r.startedAt) || '—'}–{fmtClock(r.endedAt) || '…'}</Chip>}
        </div>
        <Muted>{fmtLocation(r)}</Muted>
      </div>
    ),
  },
  {
    type: 'Reconciliation', base: '/api/admin/recon', color: 'var(--color-yellow)',
    roles: ['admin', 'superadmin', 'dev'],
    when: (r) => r.day || '—',
    canDecide: (r) => r.status === 'pending',
    reason: (r) => r.reason,
    details: (r) => (
      <div className="flex flex-col gap-1.5">
        <div className="text-[var(--color-text-main)]">{reconProposed(r)}</div>
      </div>
    ),
  },
];

function viewerRole() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('user') || 'null')?.role ?? null; } catch { return null; }
}

// One combined approvals list across every type the viewer's role permits, with
// a Type badge per row (no per-type tabs). Actions route to each row's own
// endpoint. IT Team is read-only; superadmin can delete reconciliation logs.
export default function AllApprovalsPanel() {
  const [role] = useState(viewerRole);
  const readOnly = role === 'it_team';
  const isSuper = role === 'superadmin';
  const [sources] = useState(() => SOURCES.filter((s) => s.roles.includes(role)));

  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const qs = status === 'all' ? '' : `?status=${status}`;
      const errs = [];
      const lists = await Promise.all(
        sources.map(async (s) => {
          try {
            const res = await apiFetch(`${s.base}${qs}`, { headers, cache: 'no-store' });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            return (json.requests || []).map((r) => ({ r, source: s, key: `${s.type}-${r.id}` }));
          } catch (e) {
            errs.push(`${s.type}: ${e.message}`);
            return [];
          }
        }),
      );
      // Newest first across all types (createdAt when present).
      const merged = lists.flat().sort((a, b) => new Date(b.r.createdAt || 0) - new Date(a.r.createdAt || 0));
      setRows(merged);
      setError(errs.join(' · '));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status, sources]);

  useEffect(() => { load(); }, [load]);

  const decide = async (row, decision) => {
    const note = decision === 'rejected' ? (prompt('Optional note for rejection:') ?? null) : '';
    if (note === null) return; // cancelled the reject prompt
    setBusyKey(row.key); setError(''); setFeedback('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${row.source.base}/${encodeURIComponent(row.r.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decision, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback(`${row.source.type} request ${decision}.`);
      setTimeout(() => setFeedback(''), 3000);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyKey('');
    }
  };

  const remove = async (row) => {
    if (!window.confirm('Permanently delete this reconciliation log? Any attendance already applied on approval is kept.')) return;
    setBusyKey(row.key); setError(''); setFeedback('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${row.source.base}/${encodeURIComponent(row.r.id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback('Reconciliation log deleted.');
      setTimeout(() => setFeedback(''), 3000);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyKey('');
    }
  };

  const list = rows || [];

  if (sources.length === 0) {
    return <div className="card text-sm text-[var(--color-text-muted)]">You don&apos;t have any approvals to review.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[var(--color-card-bg)] border border-[var(--color-card-border)] gap-1 self-start">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-colors ${
                status === s
                  ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                <th className="py-3 px-4 font-medium">Employee</th>
                <th className="py-3 px-4 font-medium">Type</th>
                <th className="py-3 px-4 font-medium">Department</th>
                <th className="py-3 px-4 font-medium">When</th>
                <th className="py-3 px-4 font-medium">Details</th>
                <th className="py-3 px-4 font-medium">Note</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ r, source, key }) => {
                const busy = busyKey === key;
                const canDelete = isSuper && source.type === 'Reconciliation';
                const canDecide = !readOnly && source.canDecide(r);
                const badge = source.badge ? source.badge(r) : { label: source.type, color: source.color };
                return (
                  <tr key={key} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02] align-top">
                    <td className="py-3 px-4">
                      <div className="text-[var(--color-text-main)] font-medium">{r.userName || '—'}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{r.userEmail}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                        style={{ color: badge.color, border: `1px solid ${badge.color}`, background: 'rgba(150,150,150,0.08)' }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {r.department
                        ? <span className="text-[var(--color-text-main)]">{r.department}</span>
                        : <span className="text-[var(--color-text-muted)]">—</span>}
                    </td>
                    <td className="py-3 px-4 text-[var(--color-text-main)] whitespace-nowrap">{source.when(r)}</td>
                    <td className="py-3 px-4">{source.details(r)}</td>
                    <td className="py-3 px-4">
                      {source.reason && source.reason(r)
                        ? <ClampText text={source.reason(r)} />
                        : <span className="text-xs text-[var(--color-text-muted)]">—</span>}
                    </td>
                    <td className={`py-3 px-4 font-semibold capitalize ${STATUS_STYLE[r.status] || ''}`}>
                      {r.status}
                      {r.decisionNote && <div className="text-xs text-[var(--color-text-muted)] font-normal">{r.decisionNote}</div>}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {(canDecide || canDelete) ? (
                        <div className="flex gap-2 justify-end">
                          {canDecide && (
                            <>
                              <button disabled={busy} onClick={() => decide({ r, source, key }, 'approved')} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(34,197,94,0.15)] text-[var(--color-green)] border border-[var(--color-green)] disabled:opacity-50">Approve</button>
                              <button disabled={busy} onClick={() => decide({ r, source, key }, 'rejected')} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(239,68,68,0.12)] text-[var(--color-red)] border border-[rgba(239,68,68,0.4)] disabled:opacity-50">Reject</button>
                            </>
                          )}
                          {canDelete && (
                            <button disabled={busy} onClick={() => remove({ r, source, key })} className="px-3 py-1 rounded text-xs font-semibold bg-[rgba(239,68,68,0.12)] text-[var(--color-red)] border border-[rgba(239,68,68,0.4)] disabled:opacity-50">Delete</button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && list.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-[var(--color-text-muted)]">No {status === 'all' ? '' : status} requests.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={8} className="py-8 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
