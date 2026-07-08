'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import MonthNav from '@/components/MonthNav';
import { leaveOverlapsMonth } from '@/lib/attend';
import { apiFetch } from '@/lib/apiFetch';

const STATUS_BADGE = {
  pending: 'bg-[rgba(234,179,8,0.15)] text-[var(--color-yellow)]',
  approved: 'bg-[rgba(34,197,94,0.15)] text-[var(--color-green)]',
  rejected: 'bg-[rgba(239,68,68,0.15)] text-[var(--color-red)]',
  cancelled: 'bg-[rgba(148,163,184,0.15)] text-[var(--color-text-muted)]',
};

function StatusPill({ status }) {
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_BADGE[status] || STATUS_BADGE.cancelled}`}>
      {status || '—'}
    </span>
  );
}

function fmtDay(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRange(from, to) {
  if (!from) return '—';
  return from === to ? fmtDay(from) : `${fmtDay(from)} → ${fmtDay(to)}`;
}

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

const LEAVE_TYPES = ['Casual', 'Sick', 'Emergency', 'Half Day'];
const HALF_LABEL = { first: 'First half', second: 'Second half' };

// Short human label for a request's category, e.g. "Half Day (First half)".
function leaveTypeLabel(r) {
  if (!r?.leaveType) return '—';
  if (r.leaveType === 'Half Day' && r.halfDayPeriod) {
    return `Half Day (${HALF_LABEL[r.halfDayPeriod] || r.halfDayPeriod})`;
  }
  return r.leaveType;
}

const ICONS = {
  total: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
  ),
  approved: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
  ),
  pending: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
  ),
};

// ---------------------------------------------------------------------------
// Leave request tab
// ---------------------------------------------------------------------------
function LeavePanel() {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const [showForm, setShowForm] = useState(false);
  const [leaveType, setLeaveType] = useState('Casual');
  const [halfDayPeriod, setHalfDayPeriod] = useState('first');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [details, setDetails] = useState('');
  // Resolved leave metadata: Department, Line Manager and the list of approver
  // names (team leader + super admin) for the "Approved by" picker.
  const [leaveMeta, setLeaveMeta] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await apiFetch('/api/me/leave', {
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Load the leave metadata once: Department, Line Manager and approver names,
  // resolved server-side from the org hierarchy. Default "Approved by" to the
  // first approver (the line manager) unless the user already picked one.
  useEffect(() => {
    const token = localStorage.getItem('token');
    apiFetch('/api/me/leave-meta', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => {
        setLeaveMeta(j || null);
        if (j?.approvers?.length) setApprovedBy((cur) => cur || j.approvers[0]);
      })
      .catch(() => setLeaveMeta(null));
  }, []);

  const myDepartment = leaveMeta?.department || '';
  const myLineManager = leaveMeta?.lineManager || '';
  const approverOptions = leaveMeta?.approvers || [];

  // Close the modal on Escape.
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const isHalf = leaveType === 'Half Day';

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    // A half day is a single date worth 0.5; otherwise it's a From→To range.
    const effectiveTo = isHalf ? fromDay : toDay;
    if (!fromDay || (!isHalf && !toDay)) {
      setFormError(isHalf ? 'Please pick the date for your half day.' : 'From and To dates are required.');
      return;
    }
    if (!isHalf && fromDay > toDay) {
      setFormError('“From” date must be on or before “To” date.');
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/me/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fromDay,
          toDay: effectiveTo,
          subject: leaveType,
          details: details.trim(),
          leaveType,
          halfDayPeriod: isHalf ? halfDayPeriod : null,
          approvedBy: approvedBy.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setShowForm(false);
      setLeaveType('Casual');
      setHalfDayPeriod('first');
      setFromDay('');
      setToDay('');
      setApprovedBy('');
      setDetails('');
      setFeedback('Leave request submitted.');
      setTimeout(() => setFeedback(''), 4000);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const list = useMemo(
    () => (requests || []).filter((r) => leaveOverlapsMonth(r, ym.y, ym.m)),
    [requests, ym],
  );
  const approved = list.filter((r) => r.status === 'approved').length;
  const pending = list.filter((r) => r.status === 'pending').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <MonthNav value={ym} onChange={setYm} />
        <button onClick={() => { setShowForm(true); setFormError(''); }} className="btn-primary py-2 px-4 text-sm">
          + Request leave
        </button>
        <button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>
      </div>

      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowForm(false)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="card glossy w-full max-w-lg flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Request leave</h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {/* Leave category — picking "Half Day" reveals the first/second-half choice below. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Leave type</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {LEAVE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setLeaveType(t)}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
                      leaveType === t
                        ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border-[var(--color-purple)]'
                        : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-card-border)] hover:text-[var(--color-text-main)]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {isHalf ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Date</label>
                  <input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className={inputCls} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Which half?</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['first', 'second'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setHalfDayPeriod(p)}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
                          halfDayPeriod === p
                            ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border-[var(--color-purple)]'
                            : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-card-border)] hover:text-[var(--color-text-main)]'
                        }`}
                      >
                        {HALF_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">From</label>
                  <input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className={inputCls} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">To</label>
                  <input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className={inputCls} required />
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Department</label>
                <input type="text" value={myDepartment || '—'} readOnly disabled className={`${inputCls} opacity-60 cursor-not-allowed`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Line Manager</label>
                <input type="text" value={myLineManager || '—'} readOnly disabled className={`${inputCls} opacity-60 cursor-not-allowed`} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Approved by</label>
              {approverOptions.length > 0 ? (
                <select value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className={inputCls}>
                  {approverOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              ) : (
                <input type="text" maxLength={120} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Who should approve this request?" className={inputCls} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Details (optional)</label>
              <textarea rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} className={`${inputCls} resize-y`} />
            </div>
            {formError && <p className="text-sm text-[var(--color-red)]">{formError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setShowForm(false)} className="btn-outline py-2 px-4 text-sm">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total requests" value={list.length} color="purple" icon={ICONS.total} />
        <KpiCard label="Approved" value={approved} color="green" icon={ICONS.approved} />
        <KpiCard label="Pending" value={pending} color="yellow" icon={ICONS.pending} />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-[11px] uppercase tracking-wider border-b border-[var(--color-card-border)] bg-white/[0.02]">
                <th className="py-3 px-5 font-medium">Dates</th>
                <th className="py-3 px-5 font-medium">Type</th>
                <th className="py-3 px-5 font-medium text-center">Days</th>
                <th className="py-3 px-5 font-medium">Approved by</th>
                <th className="py-3 px-5 font-medium">Details</th>
                <th className="py-3 px-5 font-medium">Status</th>
                <th className="py-3 px-5 font-medium">Decision note</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.03] transition-colors align-top">
                  <td className="py-3.5 px-5 text-[var(--color-text-main)] font-medium whitespace-nowrap">{fmtRange(r.fromDay, r.toDay)}</td>
                  <td className="py-3.5 px-5 whitespace-nowrap">
                    {r.leaveType ? (
                      <span className="inline-block px-2 py-0.5 rounded-md bg-[rgba(150,150,150,0.12)] text-[var(--color-text-main)] text-xs">{leaveTypeLabel(r)}</span>
                    ) : <span className="text-[var(--color-text-muted)]">—</span>}
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <span className="inline-block min-w-[2rem] px-2 py-0.5 rounded-md bg-white/[0.05] text-[var(--color-text-main)] text-xs">{r.totalDays ?? '—'}</span>
                  </td>
                  <td className="py-3.5 px-5 text-[var(--color-text-main)]">{r.approvedBy || '—'}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)] max-w-[280px] truncate" title={r.details || ''}>{r.details || '—'}</td>
                  <td className="py-3.5 px-5"><StatusPill status={r.status} /></td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)] text-xs max-w-[220px]">{r.decisionNote || '—'}</td>
                </tr>
              ))}
              {!loading && list.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-[var(--color-text-muted)]">No leave requests for this month.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={7} className="py-12 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset request tab
// ---------------------------------------------------------------------------
function AssetsPanel() {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ assetName: '', assetType: '', description: '', fromDay: '', toDay: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/me/asset', { headers: authHeader(), cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRequests(json.requests || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.assetName.trim() || !form.fromDay || !form.toDay) {
      setFormError('Asset name, From and To are required.');
      return;
    }
    if (form.fromDay > form.toDay) {
      setFormError('“From” date must be on or before “To” date.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/me/asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          assetName: form.assetName.trim(),
          assetType: form.assetType.trim(),
          description: form.description.trim(),
          fromDay: form.fromDay,
          toDay: form.toDay,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setShowForm(false);
      setForm({ assetName: '', assetType: '', description: '', fromDay: '', toDay: '' });
      setFeedback('Asset request submitted.');
      setTimeout(() => setFeedback(''), 4000);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const list = requests || [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button onClick={() => { setShowForm(true); setFormError(''); }} className="btn-primary py-2 px-4 text-sm">+ Apply for asset</button>
        <button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>
      </div>

      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card glossy w-full max-w-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Apply for asset</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Asset name</label>
                <input type="text" maxLength={120} value={form.assetName} onChange={set('assetName')} placeholder="e.g. MacBook Pro 14" className={inputCls} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Type</label>
                <input type="text" maxLength={60} value={form.assetType} onChange={set('assetType')} placeholder="e.g. Laptop" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">From</label>
                <input type="date" value={form.fromDay} onChange={set('fromDay')} className={inputCls} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">To</label>
                <input type="date" value={form.toDay} onChange={set('toDay')} className={inputCls} required />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Description (optional)</label>
              <textarea rows={3} maxLength={2000} value={form.description} onChange={set('description')} className={`${inputCls} resize-y`} placeholder="Why you need it / any specifics" />
            </div>
            {formError && <p className="text-sm text-[var(--color-red)]">{formError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setShowForm(false)} className="btn-outline py-2 px-4 text-sm">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-[11px] uppercase tracking-wider border-b border-[var(--color-card-border)] bg-white/[0.02]">
                <th className="py-3 px-5 font-medium">Asset</th>
                <th className="py-3 px-5 font-medium">Type</th>
                <th className="py-3 px-5 font-medium">Dates</th>
                <th className="py-3 px-5 font-medium">Status</th>
                <th className="py-3 px-5 font-medium">Approvals</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.03] align-top">
                  <td className="py-3.5 px-5 text-[var(--color-text-main)] font-medium">
                    {r.assetName || '—'}
                    {r.description && <div className="text-xs text-[var(--color-text-muted)] max-w-[240px]">{r.description}</div>}
                  </td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)]">{r.assetType || '—'}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-main)] whitespace-nowrap">{fmtRange(r.fromDay, r.toDay)}</td>
                  <td className="py-3.5 px-5"><StatusPill status={r.status} /></td>
                  <td className="py-3.5 px-5 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                    Lead: <span className="capitalize text-[var(--color-text-main)]">{r.requiresLead ? r.leadStatus : 'n/a'}</span>
                    {' · '}Admin: <span className="capitalize text-[var(--color-text-main)]">{r.adminStatus}</span>
                  </td>
                </tr>
              ))}
              {!loading && list.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-[var(--color-text-muted)]">No asset requests yet.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="py-12 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { key: 'leave', label: 'Leave request' },
  { key: 'assets', label: 'Asset request' },
];

export default function ApplicationPage() {
  const [tab, setTab] = useState('leave');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Application"
        subtitle="Submit and track your leave and asset requests"
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--color-card-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-[var(--color-primary)] text-[var(--color-text-main)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'leave' ? <LeavePanel /> : <AssetsPanel />}
    </div>
  );
}
