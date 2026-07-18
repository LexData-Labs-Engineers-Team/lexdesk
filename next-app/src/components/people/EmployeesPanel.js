'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import EmployeeAvatar from '@/components/EmployeeAvatar';
import MemberCard from '@/components/people/MemberCard';
import { useAttendData } from '@/lib/useAttendData';
import { perEmployeeStats, fmtTime, onlyStaff, inBdMonth } from '@/lib/attend';
import { apiFetch } from '@/lib/apiFetch';

const PAGE_SIZES = [10, 25, 50];
// Canonical departments — always offered even before their team doc exists.
// (IT is a role, not a department, so it's intentionally not listed here.)
const DEPARTMENTS = ['Engineering', 'Marketing', 'Project'];
// Assignable management roles (mirrors the backend /api/management/role).
const ROLE_OPTIONS = [
  { key: 'team_leader', label: 'Team Leader' },
  { key: 'it', label: 'IT' },
  { key: 'dev', label: 'Dev' },
];

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

export default function EmployeesPanel({ initialView = 'grid' } = {}) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  // Present/late stats in the List view are scoped to the current month.
  const [ym] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const { employees, events, loading, error, refresh } = useAttendData(['employees', 'attendance'], { month: ym });
  const [teams, setTeams] = useState([]);
  // A system admin (superadmin) needs to see ADMINS too — to open the org
  // admin's profile and reset their password. Regular admins see staff
  // (employees + IT team) so IT members' login-security controls are reachable.
  const [isSuper, setIsSuper] = useState(false);
  // Management (role assignment) is admin/superadmin only — the IT Team role
  // sees the employee views but not the Management tab/actions.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem('user') || 'null')?.role;
      setIsSuper(r === 'superadmin');
      setIsAdmin(r === 'admin' || r === 'superadmin' || r === 'dev');
    } catch { setIsSuper(false); setIsAdmin(false); }
  }, []);

  // Add-employee modal state.
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', employeeId: '', designation: '', department: '', contactNumber: '', birthDate: '', joiningDate: '' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [created, setCreated] = useState(null); // { email, temporaryPassword }

  // Add-management-role modal + shared op feedback (assign / revoke).
  const [feedback, setFeedback] = useState('');
  const [opError, setOpError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [showMgmt, setShowMgmt] = useState(false);
  const [mgmtQuery, setMgmtQuery] = useState('');
  const [mgmtFocused, setMgmtFocused] = useState(false);
  const [mgmtEmp, setMgmtEmp] = useState(null);
  const [mgmtDept, setMgmtDept] = useState('');
  const [mgmtRole, setMgmtRole] = useState('team_leader');
  const [mgmtSaving, setMgmtSaving] = useState(false);
  const [mgmtError, setMgmtError] = useState('');

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const loadTeams = useCallback(() => {
    apiFetch('/api/teams', { headers: authHeader(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((j) => setTeams(j.teams || []))
      .catch(() => setTeams([]));
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  const leaderUids = useMemo(() => new Set((teams || []).map((t) => String(t.leaderUid)).filter(Boolean)), [teams]);
  const teamNameOf = (e) => e.teamName || (teams.find((t) => t.id === e.teamId)?.name) || null;

  // Department options: the canonical list plus any existing team names, deduped
  // (case-insensitive) so every department is selectable even before its team
  // doc has been created.
  const deptOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const d of [...DEPARTMENTS, ...teams.map((t) => t.name)]) {
      const name = (d || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }, [teams]);

  const monthEvents = useMemo(() => (events || []).filter((e) => inBdMonth(e.timestamp, ym.y, ym.m)), [events, ym]);
  const stats = useMemo(() => perEmployeeStats(monthEvents), [monthEvents]);

  const rows = useMemo(
    () =>
      (isSuper ? (employees || []) : onlyStaff(employees)).map((e) => {
        const s = stats[e.id] || { presentDays: 0, lateDays: 0, lastCheckIn: null };
        return { ...e, presentDays: s.presentDays, late: s.lateDays, lastCheckIn: s.lastCheckIn };
      }),
    [employees, stats, isSuper],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (e) => (e.name || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Department view (admin-only page) groups every matching employee by their
  // department, falling back to team name then "Unassigned". Not paginated — an
  // org-wide overview. "Unassigned" sorts last.
  const deptGroups = useMemo(() => {
    const byDept = new Map();
    for (const e of filtered) {
      const name = (e.department || teamNameOf(e) || '').trim() || 'Unassigned';
      if (!byDept.has(name)) byDept.set(name, []);
      byDept.get(name).push(e);
    }
    return [...byDept.entries()]
      .map(([name, emps]) => ({ name, emps }))
      .sort((a, b) => (a.name === 'Unassigned' ? 1 : b.name === 'Unassigned' ? -1 : a.name.localeCompare(b.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, teams]);

  // ── Management (roles) ──────────────────────────────────────────────────
  const roleOf = (e) => String(e.role || '').toUpperCase();
  // Everyone can be picked for a management role except org admins (the backend
  // also refuses to change admin/superadmin accounts).
  const assignable = useMemo(
    () => (employees || []).filter((e) => { const r = roleOf(e); return r !== 'ADMIN' && r !== 'SUPER_ADMIN' && r !== 'DEV'; }),
    [employees],
  );
  const mgmtSuggestions = useMemo(() => {
    const q = mgmtQuery.trim().toLowerCase();
    const base = q
      ? assignable.filter((e) => (e.name || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q))
      : assignable;
    return base.slice(0, 50);
  }, [assignable, mgmtQuery]);
  // Who currently holds a management role: team leaders (from teams) + IT.
  const roleRows = useMemo(() => {
    const leaders = (teams || [])
      .filter((t) => t.leaderUid)
      .map((t) => ({ key: `lead:${t.id}`, kind: 'lead', refId: t.id, employee: t.leaderName || '—', department: t.name, role: 'Team Leader' }));
    const its = (employees || [])
      .filter((e) => roleOf(e) === 'IT_TEAM')
      .map((e) => ({ key: `it:${e.id}`, kind: 'it', refId: e.id, employee: e.name || e.email, department: e.department || e.teamName || '—', role: 'IT' }));
    const devs = (employees || [])
      .filter((e) => roleOf(e) === 'DEV')
      .map((e) => ({ key: `dev:${e.id}`, kind: 'dev', refId: e.id, employee: e.name || e.email, department: e.department || e.teamName || '—', role: 'Dev' }));
    return [...leaders, ...its, ...devs];
  }, [teams, employees]);

  const closeMgmt = () => {
    setShowMgmt(false);
    setMgmtQuery(''); setMgmtFocused(false); setMgmtEmp(null);
    setMgmtDept(''); setMgmtRole('team_leader'); setMgmtError('');
  };

  const submitMgmt = async (ev) => {
    ev.preventDefault();
    setMgmtError('');
    if (!mgmtEmp) { setMgmtError('Select an employee.'); return; }
    if (mgmtRole === 'team_leader' && !mgmtDept) { setMgmtError('Select a department.'); return; }
    setMgmtSaving(true);
    try {
      const res = await fetch('/api/management/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ uid: mgmtEmp.id, department: mgmtDept, role: mgmtRole }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback('Management role assigned.');
      setOpError('');
      setTimeout(() => setFeedback(''), 3000);
      closeMgmt();
      loadTeams();
      refresh();
    } catch (err) {
      setMgmtError(err.message);
    } finally {
      setMgmtSaving(false);
    }
  };

  // Revoke a management role from the Management table.
  const revokeMgmt = async (row) => {
    if (!window.confirm(`Remove ${row.employee} as ${row.role}?`)) return;
    setBusyKey(row.key);
    setOpError('');
    try {
      const res = row.kind === 'lead'
        ? await fetch(`/api/teams/${encodeURIComponent(row.refId)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ leaderUid: null }),
          })
        : await fetch(`/api/employees/${encodeURIComponent(row.refId)}/role`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ role: 'EMPLOYEE' }),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFeedback('Management role removed.');
      setTimeout(() => setFeedback(''), 3000);
      loadTeams();
      refresh();
    } catch (err) {
      setOpError(err.message);
    } finally {
      setBusyKey('');
    }
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    setAddError('');
    if (!addForm.name.trim() || !addForm.email.trim()) {
      setAddError('Name and email are required.');
      return;
    }
    setAdding(true);
    try {
      // The chosen department maps to a team. Reuse an existing team of that
      // name, otherwise create it on the fly so the employee is grouped under it.
      const deptName = addForm.department.trim();
      let teamId = null;
      if (deptName) {
        teamId = teams.find((t) => t.name.toLowerCase() === deptName.toLowerCase())?.id || null;
        if (!teamId) {
          const tRes = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ name: deptName }),
          });
          const tJson = await tRes.json().catch(() => ({}));
          if (!tRes.ok) throw new Error(tJson.error || 'Could not create the department.');
          teamId = tJson.id;
        }
      }
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          name: addForm.name.trim(),
          email: addForm.email.trim(),
          employeeId: addForm.employeeId.trim() || null,
          teamId: teamId || null,
          designation: addForm.designation.trim() || null,
          department: deptName || null,
          contactNumber: addForm.contactNumber.trim() || null,
          birthDate: addForm.birthDate || null,
          joiningDate: addForm.joiningDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const emp = json.employee || {};
      setCreated({ email: emp.email || addForm.email.trim(), temporaryPassword: emp.temporaryPassword || '' });
      setAddForm({ name: '', email: '', employeeId: '', designation: '', department: '', contactNumber: '', birthDate: '', joiningDate: '' });
      loadTeams();
      refresh();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const closeAdd = () => {
    setShowAdd(false);
    setCreated(null);
    setAddError('');
  };

  // One employee tile — shared by the Grid and Department views. Uses the rich
  // member card (same design as the Attendance → Team Members view); clicking
  // opens the employee's profile. teamName is resolved so the card's Department
  // row falls back to the team name when no department is set.
  const empCard = (e) => (
    <MemberCard
      key={e.id}
      m={{ ...e, teamName: teamNameOf(e) }}
      onOpen={(m) => router.push(`/dashboard/employees/${encodeURIComponent(m.id)}`)}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employees"
        subtitle={`${filtered.length} of ${rows.length} employees`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowAdd(true); setCreated(null); setAddError(''); }} className="btn-primary py-2 px-4 text-sm">+ Add employee</button>
            {isAdmin && <button onClick={() => { setShowMgmt(true); setMgmtError(''); }} className="btn-primary py-2 px-4 text-sm">+ Add Management</button>}
            <button onClick={() => { refresh(); loadTeams(); }} className="btn-outline py-2 px-4 text-sm">Refresh</button>
          </div>
        }
      />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}
      {feedback && <div className="card text-[var(--color-green)] text-sm">{feedback}</div>}
      {opError && <div className="card text-[var(--color-red)] text-sm">{opError}</div>}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeAdd}>
          <div className="card glossy w-full max-w-lg flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Add employee</h2>
              <button onClick={closeAdd} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>

            {created ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-[var(--color-green)]">Employee created. Share these sign-in details — they must change the password on first login.</p>
                <div className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg p-3 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Email</span><span className="text-[var(--color-text-main)]">{created.email}</span></div>
                  <div className="flex justify-between gap-3 mt-1"><span className="text-[var(--color-text-muted)]">Temp password</span><span className="text-[var(--color-text-main)] font-mono">{created.temporaryPassword || '—'}</span></div>
                </div>
                <div className="flex justify-end">
                  <button onClick={closeAdd} className="btn-primary py-2 px-5 text-sm">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submitAdd} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Full name</label>
                  <input type="text" maxLength={120} value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Email</label>
                  <input type="email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Employee ID</label>
                    <input type="text" maxLength={50} value={addForm.employeeId} onChange={(e) => setAddForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder="e.g. 700036 (optional)" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Designation</label>
                    <input type="text" maxLength={80} value={addForm.designation} onChange={(e) => setAddForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Software Engineer" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Department</label>
                    <select value={addForm.department} onChange={(e) => setAddForm((f) => ({ ...f, department: e.target.value }))} className={inputCls}>
                      <option value="">— select department —</option>
                      {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Contact number</label>
                    <input type="tel" maxLength={30} value={addForm.contactNumber} onChange={(e) => setAddForm((f) => ({ ...f, contactNumber: e.target.value }))} placeholder="e.g. +880 1XXX-XXXXXX" className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Date of joining</label>
                    <input type="date" value={addForm.joiningDate} onChange={(e) => setAddForm((f) => ({ ...f, joiningDate: e.target.value }))} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Date of birth</label>
                    <input type="date" value={addForm.birthDate} onChange={(e) => setAddForm((f) => ({ ...f, birthDate: e.target.value }))} className={inputCls} />
                  </div>
                </div>
                {addError && <p className="text-sm text-[var(--color-red)]">{addError}</p>}
                <div className="flex gap-2 justify-end pt-1">
                  <button type="button" onClick={closeAdd} className="btn-outline py-2 px-4 text-sm">Cancel</button>
                  <button type="submit" disabled={adding} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{adding ? 'Creating…' : 'Create employee'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showMgmt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeMgmt}>
          <div className="card glossy w-full max-w-md flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Add management role</h2>
              <button onClick={closeMgmt} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>

            <form onSubmit={submitMgmt} className="flex flex-col gap-4">
              {/* Employee autocomplete */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Employee</label>
                {mgmtEmp ? (
                  <div className="flex items-center justify-between gap-2 bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm text-[var(--color-text-main)]">{mgmtEmp.name || '—'}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{mgmtEmp.email}</div>
                    </div>
                    <button type="button" onClick={() => { setMgmtEmp(null); setMgmtQuery(''); }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-sm" aria-label="Clear">✕</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={mgmtQuery}
                      onChange={(e) => setMgmtQuery(e.target.value)}
                      onFocus={() => setMgmtFocused(true)}
                      onBlur={() => setTimeout(() => setMgmtFocused(false), 150)}
                      placeholder="Search or select an employee…"
                      className={`${inputCls} w-full`}
                      autoFocus
                    />
                    {mgmtFocused && (
                      <div className="absolute z-10 mt-1 w-full card p-1 max-h-56 overflow-y-auto">
                        {mgmtSuggestions.map((e) => (
                          <button
                            type="button"
                            key={e.id}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => { setMgmtEmp(e); setMgmtQuery(''); setMgmtFocused(false); }}
                            className="w-full text-left px-3 py-2 rounded hover:bg-white/[0.05]"
                          >
                            <div className="text-sm text-[var(--color-text-main)]">{e.name || '—'}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{e.email}</div>
                          </button>
                        ))}
                        {mgmtSuggestions.length === 0 && (
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
                <select value={mgmtRole} onChange={(e) => setMgmtRole(e.target.value)} className={inputCls}>
                  {ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>

              {/* Department — only a team leader is tied to a department. */}
              {mgmtRole === 'team_leader' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Department</label>
                  <select value={mgmtDept} onChange={(e) => setMgmtDept(e.target.value)} className={inputCls}>
                    <option value="">— select department —</option>
                    {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}

              {mgmtError && <p className="text-sm text-[var(--color-red)]">{mgmtError}</p>}

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={closeMgmt} className="btn-outline py-2 px-4 text-sm">Cancel</button>
                <button type="submit" disabled={mgmtSaving} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">
                  {mgmtSaving ? 'Saving…' : 'Assign role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card flex flex-wrap items-center gap-3">
        {view !== 'management' && (
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 min-w-[200px] bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]"
          />
        )}
        <div className="flex gap-2">
          <button onClick={() => setView('list')} className={`px-3 py-2 rounded-lg text-xs font-semibold ${view === 'list' ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>List</button>
          <button onClick={() => setView('grid')} className={`px-3 py-2 rounded-lg text-xs font-semibold ${view === 'grid' ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>Grid</button>
          <button onClick={() => setView('department')} className={`px-3 py-2 rounded-lg text-xs font-semibold ${view === 'department' ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>Department</button>
          {isAdmin && <button onClick={() => setView('management')} className={`px-3 py-2 rounded-lg text-xs font-semibold ${view === 'management' ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>Management</button>}
        </div>
        {view !== 'management' && (
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); }}
            className="bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)]"
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
          </select>
        )}
      </div>

      {loading && !rows.length && <div className="card text-[var(--color-text-muted)] text-sm">Loading…</div>}

      {view === 'management' ? (
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
                      <button onClick={() => revokeMgmt(r)} disabled={busyKey === r.key} className="btn-outline py-1 px-3 text-xs text-[var(--color-red)] disabled:opacity-50">
                        {busyKey === r.key ? '…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && roleRows.length === 0 && (
                  <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">No management roles yet. Use “+ Add Management”.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : view === 'list' ? (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                  <th className="py-3 px-4 font-medium">Employee</th>
                  <th className="py-3 px-4 font-medium">Team</th>
                  <th className="py-3 px-4 font-medium">Role</th>
                  <th className="py-3 px-4 font-medium text-center">Present days</th>
                  <th className="py-3 px-4 font-medium text-center">Late</th>
                  <th className="py-3 px-4 font-medium">Last seen</th>
                  <th className="py-3 px-4 font-medium text-center">Face</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((e) => (
                  <tr key={e.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02]">
                    <td className="py-3 px-4">
                      <Link href={`/dashboard/employees/${encodeURIComponent(e.id)}`} className="flex items-center gap-3 no-underline text-[var(--color-text-main)]">
                        <EmployeeAvatar id={e.id} name={e.name} size={36} />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {e.name || '—'}
                            {leaderUids.has(String(e.id)) && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)]">Lead</span>}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)]">{e.email}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-[var(--color-text-muted)]">{teamNameOf(e) || '—'}</td>
                    <td className="py-3 px-4 text-[var(--color-text-muted)] capitalize">{(e.role || '').toLowerCase()}</td>
                    <td className="py-3 px-4 text-center text-[var(--color-green)] font-semibold">{e.presentDays}</td>
                    <td className="py-3 px-4 text-center text-[var(--color-yellow)] font-semibold">{e.late}</td>
                    <td className="py-3 px-4 text-xs text-[var(--color-text-muted)] whitespace-nowrap">{e.lastCheckIn ? fmtTime(e.lastCheckIn) : '—'}</td>
                    <td className="py-3 px-4 text-center">{e.faceEnrolledAt ? <span className="text-[var(--color-green)]">✓</span> : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                  </tr>
                ))}
                {!loading && pageRows.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-[var(--color-text-muted)]">No employees found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-4 border-t border-[var(--color-card-border)] text-xs text-[var(--color-text-muted)]">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-outline py-1 px-3 disabled:opacity-30">Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-outline py-1 px-3 disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pageRows.map((e) => empCard(e))}
          {!loading && pageRows.length === 0 && (
            <div className="col-span-full text-center text-[var(--color-text-muted)] py-8">No employees found.</div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {deptGroups.map((g) => (
            <div key={g.name} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-[var(--color-text-main)]">{g.name}</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[rgba(150,150,150,0.15)] text-[var(--color-text-muted)]">
                  {g.emps.length} {g.emps.length === 1 ? 'person' : 'people'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {g.emps.map((e) => empCard(e))}
              </div>
            </div>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-[var(--color-text-muted)] py-8">No employees found.</div>
          )}
        </div>
      )}
    </div>
  );
}
