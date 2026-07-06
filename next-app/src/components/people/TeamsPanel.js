'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import PageHeader from '@/components/PageHeader';

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

const DEPARTMENTS = ['Engineering', 'Marketing', 'Project'];
const ROLE_OPTIONS = [
  { key: 'team_leader', label: 'Team Leader' },
  { key: 'it', label: 'IT' },
  { key: 'dev', label: 'Dev' },
];

export default function TeamsPanel() {
  const [teams, setTeams] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(''); // keyed busy flag for row actions

  // "Add Management Role" modal.
  const [showAdd, setShowAdd] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [empFocused, setEmpFocused] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('team_leader');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [tRes, eRes] = await Promise.all([
        fetch('/api/teams', { headers: authHeader(), cache: 'no-store' }),
        fetch('/api/attenddesk?resource=employees', { headers: authHeader(), cache: 'no-store' }),
      ]);
      const tJson = await tRes.json();
      if (!tRes.ok) throw new Error(tJson.error || `HTTP ${tRes.status}`);
      setTeams(tJson.teams || []);
      const eJson = await eRes.json();
      if (eRes.ok) setEmployees(eJson.employees || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const roleOf = (e) => String(e.role || '').toUpperCase();

  // Every employee can be picked for a management role except org admins
  // (the backend also refuses to change admin/superadmin accounts).
  const assignable = useMemo(
    () => employees.filter((e) => { const r = roleOf(e); return r !== 'ADMIN' && r !== 'SUPER_ADMIN' && r !== 'DEV'; }),
    [employees],
  );
  // Empty query → suggest the whole list; typing filters it.
  const suggestions = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    const base = q
      ? assignable.filter((e) => (e.name || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q))
      : assignable;
    return base.slice(0, 50);
  }, [assignable, empQuery]);

  // Unified view of who currently holds a management role.
  const roleRows = useMemo(() => {
    const leaders = teams
      .filter((t) => t.leaderUid)
      .map((t) => ({ key: `lead:${t.id}`, kind: 'lead', refId: t.id, employee: t.leaderName || '—', department: t.name, role: 'Team Leader' }));
    const its = employees
      .filter((e) => roleOf(e) === 'IT_TEAM')
      .map((e) => ({ key: `it:${e.id}`, kind: 'it', refId: e.id, employee: e.name || e.email, department: e.department || e.teamName || '—', role: 'IT' }));
    const devs = employees
      .filter((e) => roleOf(e) === 'DEV')
      .map((e) => ({ key: `dev:${e.id}`, kind: 'dev', refId: e.id, employee: e.name || e.email, department: e.department || e.teamName || '—', role: 'Dev' }));
    return [...leaders, ...its, ...devs];
  }, [teams, employees]);

  const closeModal = () => {
    setShowAdd(false);
    setEmpQuery('');
    setEmpFocused(false);
    setSelectedEmp(null);
    setDepartment('');
    setRole('team_leader');
    setFormError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!selectedEmp) { setFormError('Select an employee.'); return; }
    if (role === 'team_leader' && !department) { setFormError('Select a department.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/management/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ uid: selectedEmp.id, department, role }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback('Management role assigned.');
      setTimeout(() => setFeedback(''), 3000);
      closeModal();
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Revoke a role from the unified table.
  const revoke = async (row) => {
    if (!window.confirm(`Remove ${row.employee} as ${row.role}?`)) return;
    setBusy(row.key);
    setError('');
    try {
      const res = row.kind === 'lead'
        ? await fetch(`/api/teams/${encodeURIComponent(row.refId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ leaderUid: null }),
          })
        : await fetch(`/api/employees/${encodeURIComponent(row.refId)}/role`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ role: 'EMPLOYEE' }),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback('Management role removed.');
      setTimeout(() => setFeedback(''), 3000);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Management"
        subtitle="Assign team leaders and IT Team members by department"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAdd(true)} className="btn-primary py-2 px-4 text-sm">+ Add Management Role</button>
            <button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>
          </div>
        }
      />

      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeModal}>
          <div className="card glossy w-full max-w-md flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Add management role</h2>
              <button onClick={closeModal} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              {/* Employee autocomplete */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Employee</label>
                {selectedEmp ? (
                  <div className="flex items-center justify-between gap-2 bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm text-[var(--color-text-main)]">{selectedEmp.name || '—'}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{selectedEmp.email}</div>
                    </div>
                    <button type="button" onClick={() => { setSelectedEmp(null); setEmpQuery(''); }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-sm" aria-label="Clear">✕</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={empQuery}
                      onChange={(e) => setEmpQuery(e.target.value)}
                      onFocus={() => setEmpFocused(true)}
                      onBlur={() => setTimeout(() => setEmpFocused(false), 150)}
                      placeholder="Search or select an employee…"
                      className={`${inputCls} w-full`}
                      autoFocus
                    />
                    {empFocused && (
                      <div className="absolute z-10 mt-1 w-full card p-1 max-h-56 overflow-y-auto">
                        {suggestions.map((e) => (
                          <button
                            type="button"
                            key={e.id}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => { setSelectedEmp(e); setEmpQuery(''); setEmpFocused(false); }}
                            className="w-full text-left px-3 py-2 rounded hover:bg-white/[0.05]"
                          >
                            <div className="text-sm text-[var(--color-text-main)]">{e.name || '—'}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{e.email}</div>
                          </button>
                        ))}
                        {suggestions.length === 0 && (
                          <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No matching employees.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Role */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
                  {ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>

              {/* Department — only a team leader is tied to a department. */}
              {role === 'team_leader' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Department</label>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls}>
                    <option value="">— select department —</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}

              {formError && <p className="text-sm text-[var(--color-red)]">{formError}</p>}

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={closeModal} className="btn-outline py-2 px-4 text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Assign role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] text-[11px] uppercase tracking-wider border-b border-[var(--color-card-border)]">
                <th className="py-3 px-5 font-medium">Employee</th>
                <th className="py-3 px-5 font-medium">Department</th>
                <th className="py-3 px-5 font-medium">Role</th>
                <th className="py-3 px-5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {roleRows.map((r) => (
                <tr key={r.key} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.03]">
                  <td className="py-3.5 px-5 text-[var(--color-text-main)] font-medium">{r.employee}</td>
                  <td className="py-3.5 px-5 text-[var(--color-text-muted)]">{r.department}</td>
                  <td className="py-3.5 px-5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.kind === 'it' ? 'bg-[rgba(56,189,248,0.15)] text-[var(--color-blue)]' : 'bg-[rgba(124,58,237,0.15)] text-[var(--color-purple)]'}`}>{r.role}</span>
                  </td>
                  <td className="py-3.5 px-5 text-right">
                    <button onClick={() => revoke(r)} disabled={busy === r.key} className="btn-outline py-1 px-3 text-xs text-[var(--color-red)] disabled:opacity-50">
                      {busy === r.key ? '…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && roleRows.length === 0 && (
                <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">No management roles yet. Use “Add Management Role”.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
