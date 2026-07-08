'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { apiFetch } from '@/lib/apiFetch';

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function NoticesPanel() {
  const [notices, setNotices] = useState(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await apiFetch('/api/admin/notices', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNotices(json.notices || []);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), pinned }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTitle(''); setBody(''); setPinned(false);
      await load();
    } catch (e) { setError(e.message); } finally { setSubmitting(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this notice?')) return;
    setBusyId(id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/notices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
    } catch (e) { setError(e.message); } finally { setBusyId(''); }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Notice Board" subtitle="Announcements visible to every employee (web + app)" actions={
        <button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>
      } />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <form onSubmit={post} className="card flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Post a notice</h2>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Title</label>
          <input type="text" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Body</label>
          <textarea rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} className={`${inputCls} resize-y`} />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-main)]">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin to top
        </label>
        <div className="flex justify-end">
          <button type="submit" disabled={submitting} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">
            {submitting ? 'Posting…' : 'Post notice'}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        {(notices || []).map((n) => (
          <div key={n.id} className="card flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {n.pinned && <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-[rgba(124,58,237,0.15)] text-[var(--color-purple)]">Pinned</span>}
                <h3 className="font-semibold text-[var(--color-text-main)]">{n.title}</h3>
              </div>
              {n.body && <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{n.body}</p>}
              <span className="text-xs text-[var(--color-text-muted)]">{fmt(n.createdAt)}</span>
            </div>
            <button onClick={() => remove(n.id)} disabled={busyId === n.id} className="btn-outline py-1.5 px-3 text-xs disabled:opacity-50">
              {busyId === n.id ? '…' : 'Delete'}
            </button>
          </div>
        ))}
        {notices && notices.length === 0 && <div className="card text-[var(--color-text-muted)] text-sm">No notices yet.</div>}
        {!notices && <div className="card text-[var(--color-text-muted)] text-sm">Loading…</div>}
      </div>
    </div>
  );
}
