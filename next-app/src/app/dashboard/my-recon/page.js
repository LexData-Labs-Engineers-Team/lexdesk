'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { apiFetch } from '@/lib/apiFetch';

const STATUS_BADGE = {
  pending: 'bg-[rgba(234,179,8,0.15)] text-[var(--color-yellow)]',
  approved: 'bg-[rgba(34,197,94,0.15)] text-[var(--color-green)]',
  rejected: 'bg-[rgba(239,68,68,0.15)] text-[var(--color-red)]',
  cancelled: 'bg-[rgba(148,163,184,0.15)] text-[var(--color-text-muted)]',
};
const StatusPill = ({ status }) => (
  <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_BADGE[status] || STATUS_BADGE.cancelled}`}>{status || '—'}</span>
);
const inputCls = 'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';
const fmtDay = (d) => { if (!d) return '—'; const dt = new Date(`${d}T00:00:00`); return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
function fmtTime(iso) {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}+06:00`;
  const d = new Date(s);
  return isNaN(d) ? null : new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

export default function MyReconPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [day, setDay] = useState('');
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await apiFetch('/api/me/recon', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.requests || []);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!day || !reason.trim()) { setFormError('Date and reason are required.'); return; }
    if (!inTime && !outTime) { setFormError('Enter at least one corrected time.'); return; }
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const proposedInIso = inTime ? `${day}T${inTime}:00+06:00` : null;
      const proposedOutIso = outTime ? `${day}T${outTime}:00+06:00` : null;
      const res = await fetch('/api/me/recon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ day, proposedInIso, proposedOutIso, reason: reason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setShowForm(false); setDay(''); setInTime(''); setOutTime(''); setReason('');
      await load();
    } catch (err) { setFormError(err.message); } finally { setBusy(false); }
  };

  const cancel = async (id) => {
    const token = localStorage.getItem('token');
    await fetch(`/api/me/recon/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    await load();
  };

  const list = rows || [];
  const approved = list.filter((r) => r.status === 'approved').length;
  const pending = list.filter((r) => r.status === 'pending').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reconciliation" subtitle="Request corrections to your attendance" actions={
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowForm(true); setFormError(''); }} className="btn-primary py-2 px-4 text-sm">+ New request</button>
          <button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>
        </div>
      } />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg flex flex-col gap-4 shadow-2xl">
            <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Reconcile attendance</h2>
            <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-[var(--color-text-muted)]">Date</label><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} required /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-[var(--color-text-muted)]">Corrected in time</label><input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} className={inputCls} /></div>
              <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-[var(--color-text-muted)]">Corrected out time</label><input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} className={inputCls} /></div>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">Approving this applies the corrected time(s) to that day's attendance.</p>
            <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-[var(--color-text-muted)]">Reason</label><textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} resize-y`} required /></div>
            {formError && <p className="text-sm text-[var(--color-red)]">{formError}</p>}
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowForm(false)} className="btn-outline py-2 px-4 text-sm">Cancel</button><button type="submit" disabled={busy} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{busy ? 'Submitting…' : 'Submit'}</button></div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total requests" value={list.length} color="purple" />
        <KpiCard label="Approved" value={approved} color="green" />
        <KpiCard label="Pending" value={pending} color="yellow" />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[var(--color-text-muted)] text-[11px] uppercase tracking-wider border-b border-[var(--color-card-border)]">
              <th className="py-3 px-5 font-medium">Date</th><th className="py-3 px-5 font-medium">Proposed in/out</th><th className="py-3 px-5 font-medium">Reason</th><th className="py-3 px-5 font-medium">Status</th><th className="py-3 px-5 font-medium"></th>
            </tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-card-border)] align-top">
                  <td className="py-3.5 px-5 whitespace-nowrap text-[var(--color-text-main)]">{fmtDay(r.day)}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-main)] whitespace-nowrap">{[fmtTime(r.proposedInIso) && `in ${fmtTime(r.proposedInIso)}`, fmtTime(r.proposedOutIso) && `out ${fmtTime(r.proposedOutIso)}`].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)] max-w-[280px]">{r.reason || '—'}</td>
                  <td className="py-3.5 px-5"><StatusPill status={r.status} /></td>
                  <td className="py-3.5 px-5">{r.status === 'pending' && <button onClick={() => cancel(r.id)} className="text-xs text-[var(--color-red)] hover:underline">Cancel</button>}</td>
                </tr>
              ))}
              {rows && list.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-[var(--color-text-muted)]">No reconciliation requests yet.</td></tr>}
              {!rows && <tr><td colSpan={5} className="py-12 text-center text-[var(--color-text-muted)]">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
