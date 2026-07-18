'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import { apiFetch } from '@/lib/apiFetch';

// Only the editable settings are shown on this page. `query` is appended verbatim.
const RESOURCES = [
  { key: 'policy', label: 'Policy' },
  { key: 'office', label: 'Office' },
];

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

// Always-editable form for the org's attendance policy.
function PolicyEditor({ data, onSaved }) {
  const buildForm = (d) => {
    const p = d?.policy || {};
    return {
      requireWifi: !!p.requireWifi,
      requireGeo: !!p.requireGeo,
      requireQr: !!p.requireQr,
      requireFace: !!p.requireFace,
      requireIp: !!p.requireIp,
      faceThreshold: p.faceThreshold ?? 0.7,
      gpsAccuracyMaxMeters: p.gpsAccuracyMaxMeters ?? 50,
    };
  };

  const [form, setForm] = useState(() => buildForm(data));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // Re-sync the form whenever fresh data arrives (initial load / Refresh / after save).
  useEffect(() => { setForm(buildForm(data)); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const body = {
        requireWifi: !!form.requireWifi,
        requireGeo: !!form.requireGeo,
        requireQr: !!form.requireQr,
        requireFace: !!form.requireFace,
        requireIp: !!form.requireIp,
        faceThreshold: Number(form.faceThreshold),
        gpsAccuracyMaxMeters: Number(form.gpsAccuracyMaxMeters),
      };
      const res = await fetch('/api/attenddesk/policy', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setOk('Policy saved.');
      setTimeout(() => setOk(''), 3000);
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const CHECKS = [
    ['requireWifi', 'Require Wi-Fi'],
    ['requireGeo', 'Require GPS / geofence'],
    ['requireQr', 'Require QR'],
    ['requireFace', 'Require face'],
    ['requireIp', 'Require office IP (web)'],
  ];
  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CHECKS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm text-[var(--color-text-main)] cursor-pointer">
            <input type="checkbox" checked={!!form[k]} onChange={() => setForm((f) => ({ ...f, [k]: !f[k] }))} className="accent-[var(--color-purple)] w-4 h-4" />
            {label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Face threshold (0–1)</label>
          <input type="number" step="0.01" min="0" max="1" value={form.faceThreshold} onChange={(e) => setForm((f) => ({ ...f, faceThreshold: e.target.value }))} className={inputCls} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Max GPS accuracy (m)</label>
          <input type="number" step="1" min="5" max="500" value={form.gpsAccuracyMaxMeters} onChange={(e) => setForm((f) => ({ ...f, gpsAccuracyMaxMeters: e.target.value }))} className={inputCls} required />
        </div>
      </div>
      {err && <p className="text-sm text-[var(--color-red)]">{err}</p>}
      {ok && <p className="text-sm text-[var(--color-green)]">{ok}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save policy'}</button>
        <button type="button" onClick={() => setForm(buildForm(data))} className="btn-outline py-2 px-4 text-sm">Reset</button>
      </div>
    </form>
  );
}

// Always-editable form for the org's office (geofence + hours + allowed networks).
function OfficeEditor({ data, onSaved }) {
  const buildForm = (d) => {
    const o = d?.office || {};
    return {
      name: o.name || '',
      lat: o.lat ?? '',
      lng: o.lng ?? '',
      radiusMeters: o.radiusMeters ?? '',
      startTime: o.startTime || '',
      endTime: o.endTime || '',
      allowedSsids: (o.allowedSsids || []).join('\n'),
      allowedBssids: (o.allowedBssids || []).join('\n'),
      allowedIps: (o.allowedIps || []).join('\n'),
    };
  };

  const [form, setForm] = useState(() => buildForm(data));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => { setForm(buildForm(data)); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = (s) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        lat: Number(form.lat),
        lng: Number(form.lng),
        radiusMeters: Number(form.radiusMeters),
        allowedSsids: lines(form.allowedSsids),
        allowedBssids: lines(form.allowedBssids),
        allowedIps: lines(form.allowedIps),
      };
      if (form.startTime) body.startTime = form.startTime;
      if (form.endTime) body.endTime = form.endTime;
      const res = await fetch('/api/attenddesk/office', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setOk('Office saved.');
      setTimeout(() => setOk(''), 3000);
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Name</label>
          <input type="text" maxLength={120} value={form.name} onChange={set('name')} className={inputCls} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Latitude</label>
          <input type="number" step="0.000001" value={form.lat} onChange={set('lat')} className={inputCls} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Longitude</label>
          <input type="number" step="0.000001" value={form.lng} onChange={set('lng')} className={inputCls} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Radius (m)</label>
          <input type="number" step="1" min="10" max="2000" value={form.radiusMeters} onChange={set('radiusMeters')} className={inputCls} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Start time</label>
            <input type="time" value={form.startTime} onChange={set('startTime')} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">End time</label>
            <input type="time" value={form.endTime} onChange={set('endTime')} className={inputCls} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Allowed Wi-Fi SSIDs (one per line)</label>
          <textarea rows={3} value={form.allowedSsids} onChange={set('allowedSsids')} className={`${inputCls} resize-y`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Allowed BSSIDs (aa:bb:cc:dd:ee:ff, one per line)</label>
          <textarea rows={3} value={form.allowedBssids} onChange={set('allowedBssids')} className={`${inputCls} resize-y`} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Allowed office IPs — web check-in (one IP or CIDR per line)</label>
          <textarea rows={3} value={form.allowedIps} onChange={set('allowedIps')} className={`${inputCls} resize-y`} placeholder="e.g. 203.0.113.42 or 203.0.113.0/24" />
          <span className="text-[11px] text-[var(--color-text-muted)]">Your office&apos;s PUBLIC internet IP — get it at api.ipify.org from an office PC. NOT a 192.168.x.x LAN address. Only enforced when &ldquo;Require office IP&rdquo; is on.</span>
        </div>
      </div>
      {err && <p className="text-sm text-[var(--color-red)]">{err}</p>}
      {ok && <p className="text-sm text-[var(--color-green)]">{ok}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save office'}</button>
        <button type="button" onClick={() => setForm(buildForm(data))} className="btn-outline py-2 px-4 text-sm">Reset</button>
      </div>
    </form>
  );
}

export default function AttendDeskPage() {
  const [state, setState] = useState({}); // { [key]: { loading?, data?, error? } }

  const load = useCallback(async () => {
    const token = localStorage.getItem('token');
    setState(Object.fromEntries(RESOURCES.map((r) => [r.key, { loading: true }])));
    await Promise.all(
      RESOURCES.map(async (r) => {
        try {
          const qs = `resource=${r.key}${r.query ? '&' + r.query : ''}`;
          const res = await apiFetch(`/api/attenddesk?${qs}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
          setState((s) => ({ ...s, [r.key]: { data: json } }));
        } catch (err) {
          setState((s) => ({ ...s, [r.key]: { error: err.message } }));
        }
      }),
    );
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        subtitle="View and update your attendance policy and office settings"
        actions={<button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>}
      />

      {RESOURCES.map((r) => {
        const st = state[r.key] || {};
        return (
          <section key={r.key} className="card">
            <h2 className="text-lg font-semibold text-[var(--color-text-main)] mb-3">{r.label}</h2>
            {st.loading && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
            {st.error && <p className="text-sm text-[var(--color-red)]">{st.error}</p>}
            {st.data != null && (
              r.key === 'policy'
                ? <PolicyEditor data={st.data} onSaved={load} />
                : <OfficeEditor data={st.data} onSaved={load} />
            )}
          </section>
        );
      })}
    </div>
  );
}
