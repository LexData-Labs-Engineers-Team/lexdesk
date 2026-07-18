'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { apiFetch } from '@/lib/apiFetch';

function fmtDay(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRange(from, to) {
  if (!from) return '—';
  return !to || from === to ? fmtDay(from) : `${fmtDay(from)} → ${fmtDay(to)}`;
}

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

export default function HolidaysPanel() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/holidays', { headers: authHeader(), cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setHolidays(json.holidays || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!fromDay || !name.trim()) {
      setFormError('Date and name are required.');
      return;
    }
    const to = toDay || fromDay;
    if (fromDay > to) {
      setFormError('“From” must be on or before “To”.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ fromDay, toDay: to, name: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFromDay('');
      setToDay('');
      setName('');
      setFeedback('Holiday added.');
      setTimeout(() => setFeedback(''), 3000);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      const res = await fetch(`/api/holidays/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Holidays"
        subtitle="Custom company holidays — shown in light blue on every employee's calendar"
        actions={<button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>}
      />

      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <form onSubmit={add} className="card flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">From</label>
          <input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className={inputCls} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">To (optional)</label>
          <input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Name</label>
          <input type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid ul-Fitr" className={inputCls} required />
        </div>
        <button type="submit" disabled={saving} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">
          {saving ? 'Adding…' : 'Add holiday'}
        </button>
      </form>
      {formError && <div className="text-sm text-[var(--color-red)] -mt-3">{formError}</div>}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-[11px] uppercase tracking-wider border-b border-[var(--color-card-border)]">
                <th className="py-3 px-5 font-medium">Holiday</th>
                <th className="py-3 px-5 font-medium">Date(s)</th>
                <th className="py-3 px-5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.03]">
                  <td className="py-3.5 px-5 text-[var(--color-text-main)] font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#38BDF8' }} />
                      {h.name}
                    </span>
                  </td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)] whitespace-nowrap">{fmtRange(h.fromDay, h.toDay)}</td>
                  <td className="py-3.5 px-5 text-right">
                    <button onClick={() => remove(h.id)} className="btn-outline py-1 px-3 text-xs text-[var(--color-red)]">Delete</button>
                  </td>
                </tr>
              ))}
              {!loading && holidays.length === 0 && (
                <tr><td colSpan={3} className="py-12 text-center text-[var(--color-text-muted)]">No custom holidays yet. Add one above.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={3} className="py-12 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
