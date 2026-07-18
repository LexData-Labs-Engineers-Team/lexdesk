'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

// Org admins + system admin: view the org and rename the company. Creating org
// admins is system-admin (superadmin) only — that form is hidden for org admins.
export default function OrganizationPage() {
  const [role, setRole] = useState(null);
  const [org, setOrg] = useState(null); // { id, name }
  const [admins, setAdmins] = useState([]);
  const [companyName, setCompanyName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState(''); // { ok, text }
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null); // { email, temporaryPassword }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try { setRole(JSON.parse(localStorage.getItem('user') || 'null')?.role ?? null); } catch { setRole(null); }
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/provision', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setOrg(json.org || null);
      setAdmins(json.admins || []);
      setCompanyName(json.org?.name || '');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { if (role === 'admin' || role === 'superadmin' || role === 'dev') load(); }, [role, load]);

  // Rename the company (org admins + superadmin). Separate from admin creation.
  const saveName = async (e) => {
    e.preventDefault();
    setNameMsg('');
    if (!companyName.trim()) { setNameMsg({ ok: false, text: 'Company name is required.' }); return; }
    setSavingName(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/provision', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyName: companyName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setOrg(json.org || org);
      setNameMsg({ ok: true, text: 'Saved.' });
      setTimeout(() => setNameMsg(''), 3000);
    } catch (e2) {
      setNameMsg({ ok: false, text: e2.message });
    } finally {
      setSavingName(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setCreated(null);
    if (!adminName.trim() || !adminEmail.trim()) {
      setError('Admin name and admin email are required.');
      return;
    }
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adminName: adminName.trim(), adminEmail: adminEmail.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCreated({ email: json.admin?.email || adminEmail.trim(), temporaryPassword: json.admin?.temporaryPassword || '' });
      setAdminName('');
      setAdminEmail('');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyPw = async () => {
    try { await navigator.clipboard.writeText(created.temporaryPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* manual copy */ }
  };

  if (role && role !== 'admin' && role !== 'superadmin' && role !== 'dev') {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Organization" subtitle="Administrators only" />
        <div className="card text-sm text-[var(--color-text-muted)]">This page is only available to administrators.</div>
      </div>
    );
  }

  const isSuper = role === 'superadmin';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Organization"
        subtitle={isSuper ? 'Company profile and admins' : 'Your company profile'}
        actions={<button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>}
      />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-4">
          <h2 className="text-base font-semibold text-[var(--color-text-main)]">Company profile</h2>
          <form onSubmit={saveName} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Company name</label>
              <input type="text" maxLength={120} value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} required />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={savingName} className="btn-primary py-2 px-5 text-sm self-start disabled:opacity-50">{savingName ? 'Saving…' : 'Save'}</button>
              {nameMsg && <span className={`text-xs ${nameMsg.ok ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}`}>{nameMsg.text}</span>}
            </div>
          </form>
        </div>

        <div className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold text-[var(--color-text-main)]">Current admins</h2>
          {admins.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No org admin yet{isSuper ? ' — create one below.' : '.'}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {admins.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm border-b border-[var(--color-card-border)] py-1.5 last:border-0">
                  <span className="text-[var(--color-text-main)]">{a.name || '—'}</span>
                  <span className="text-[var(--color-text-muted)] text-xs">{a.email}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            To reset an admin&apos;s password, open their profile in Employees → Reset password.
          </p>
        </div>
      </div>

      {isSuper && (
        <div className="card flex flex-col gap-4 lg:max-w-[calc(50%-0.5rem)]">
          <h2 className="text-base font-semibold text-[var(--color-text-main)]">Create org admin</h2>
          {created ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--color-green)]">Admin created. Share these — they must change the password on first login.</p>
              <div className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg p-3 text-sm flex flex-col gap-1">
                <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Email</span><span className="text-[var(--color-text-main)]">{created.email}</span></div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--color-text-muted)]">Temp password</span>
                  <span className="flex items-center gap-2">
                    <code className="font-mono text-[var(--color-text-main)]">{created.temporaryPassword || '—'}</code>
                    {created.temporaryPassword && <button onClick={copyPw} className="btn-outline py-1 px-2 text-xs">{copied ? 'Copied' : 'Copy'}</button>}
                  </span>
                </div>
              </div>
              <button onClick={() => setCreated(null)} className="btn-outline py-2 px-4 text-sm self-start">Create another</button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Org admin name</label>
                <input type="text" maxLength={120} value={adminName} onChange={(e) => setAdminName(e.target.value)} className={inputCls} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Org admin email</label>
                <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={inputCls} required />
              </div>
              <button type="submit" disabled={busy} className="btn-primary py-2 px-5 text-sm self-start disabled:opacity-50">
                {busy ? 'Creating…' : 'Create org admin'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
