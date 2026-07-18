'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { apiFetch } from '@/lib/apiFetch';

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

const EMPTY = { name: '', ipAddress: '', assignedTo: '', notes: '' };

export default function TrackingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyId, setBusyId] = useState('');

  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/tracking', { headers: authHeader(), cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setItems(json.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Item / accessory name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          name: form.name.trim(),
          ipAddress: form.ipAddress.trim(),
          assignedTo: form.assignedTo.trim(),
          notes: form.notes.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setForm(EMPTY);
      setFeedback('Item added.');
      setTimeout(() => setFeedback(''), 3000);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this item from tracking?')) return;
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/tracking/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeader() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tracking"
        subtitle="Assign IPs and accessories, and track who has what"
        actions={<button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>}
      />

      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <form onSubmit={add} className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold text-[var(--color-text-main)]">Add item</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Item / accessory</label>
            <input type="text" maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Dell Monitor, LAN cable, Router" className={inputCls} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">IP address</label>
            <input type="text" maxLength={64} value={form.ipAddress} onChange={(e) => setForm((f) => ({ ...f, ipAddress: e.target.value }))} placeholder="e.g. 192.168.0.42 (optional)" className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Assigned to</label>
            <input type="text" maxLength={120} value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))} placeholder="Person or device (optional)" className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Notes</label>
            <input type="text" maxLength={200} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" className={inputCls} />
          </div>
        </div>
        {formError && <p className="text-sm text-[var(--color-red)]">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">
            {saving ? 'Adding…' : 'Add item'}
          </button>
        </div>
      </form>

      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-card-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-main)]">Tracked items</h2>
          <span className="text-xs text-[var(--color-text-muted)]">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-[11px] uppercase tracking-wider border-b border-[var(--color-card-border)]">
                <th className="py-3 px-5 font-medium">Item / accessory</th>
                <th className="py-3 px-5 font-medium">IP address</th>
                <th className="py-3 px-5 font-medium">Assigned to</th>
                <th className="py-3 px-5 font-medium">Notes</th>
                <th className="py-3 px-5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.03]">
                  <td className="py-3.5 px-5 text-[var(--color-text-main)] font-medium">{it.name}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)]">{it.ipAddress || '—'}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)]">{it.assignedTo || '—'}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)] max-w-[220px]">{it.notes || '—'}</td>
                  <td className="py-3.5 px-5 text-right">
                    <button onClick={() => remove(it.id)} disabled={busyId === it.id} className="btn-outline py-1 px-3 text-xs text-[var(--color-red)] disabled:opacity-50">
                      {busyId === it.id ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-[var(--color-text-muted)]">No items tracked yet. Add one above.</td></tr>
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
