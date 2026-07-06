'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import EmployeeAvatar from '@/components/EmployeeAvatar';
import MonthNav from '@/components/MonthNav';
import { useAttendData } from '@/lib/useAttendData';
import { perEmployeeStats, fmtTime, onlyStaff, inBdMonth } from '@/lib/attend';

const PAGE_SIZES = [10, 25, 50];
// Canonical departments — always offered even before their team doc exists.
// (IT is a role, not a department, so it's intentionally not listed here.)
const DEPARTMENTS = ['Engineering', 'Marketing', 'Project'];

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

export default function EmployeesPanel() {
  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const { employees, events, loading, error, refresh } = useAttendData(['employees', 'attendance'], { month: ym });
  const [teams, setTeams] = useState([]);
  // A system admin (superadmin) needs to see ADMINS too — to open the org
  // admin's profile and reset their password. Regular admins see staff
  // (employees + IT team) so IT members' login-security controls are reachable.
  const [isSuper, setIsSuper] = useState(false);
  useEffect(() => {
    try { setIsSuper(JSON.parse(localStorage.getItem('user') || 'null')?.role === 'superadmin'); } catch { setIsSuper(false); }
  }, []);

  // Add-employee modal state.
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', employeeId: '', designation: '', department: '', contactNumber: '', birthDate: '', joiningDate: '' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [created, setCreated] = useState(null); // { email, temporaryPassword }

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const loadTeams = useCallback(() => {
    fetch('/api/teams', { headers: authHeader(), cache: 'no-store' })
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

  // One employee tile — shared by the Grid and Department views.
  const empCard = (e) => (
    <Link key={e.id} href={`/dashboard/employees/${encodeURIComponent(e.id)}`} className="card no-underline hover:border-[var(--color-purple)] transition-all">
      <div className="flex flex-col items-center text-center gap-3">
        <EmployeeAvatar id={e.id} name={e.name} size={56} />
        <div>
          <div className="font-semibold text-[var(--color-text-main)] truncate max-w-[150px] flex items-center justify-center gap-1.5">
            {e.name || '—'}
            {leaderUids.has(String(e.id)) && <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)]">Lead</span>}
          </div>
          <div className="text-xs text-[var(--color-text-muted)] truncate max-w-[150px]">{e.email}</div>
          {e.designation && <div className="text-xs text-[var(--color-text-muted)] truncate max-w-[150px]">{e.designation}</div>}
          {teamNameOf(e) && <div className="text-xs text-[var(--color-purple)] mt-0.5">{teamNameOf(e)}</div>}
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">{e.presentDays} present days · <span className="text-[var(--color-yellow)]">{e.late} late</span></div>
      </div>
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employees"
        subtitle={`${filtered.length} of ${rows.length} employees`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowAdd(true); setCreated(null); setAddError(''); }} className="btn-primary py-2 px-4 text-sm">+ Add employee</button>
            <MonthNav value={ym} onChange={setYm} />
            <button onClick={refresh} className="btn-outline py-2 px-4 text-sm">Refresh</button>
          </div>
        }
      />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

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

      <div className="card flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-[200px] bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]"
        />
        <div className="flex gap-2">
          <button onClick={() => setView('list')} className={`px-3 py-2 rounded-lg text-xs font-semibold ${view === 'list' ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>List</button>
          <button onClick={() => setView('grid')} className={`px-3 py-2 rounded-lg text-xs font-semibold ${view === 'grid' ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>Grid</button>
          <button onClick={() => setView('department')} className={`px-3 py-2 rounded-lg text-xs font-semibold ${view === 'department' ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]' : 'btn-outline'}`}>Department</button>
        </div>
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); }}
          className="bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)]"
        >
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>

      {loading && !rows.length && <div className="card text-[var(--color-text-muted)] text-sm">Loading…</div>}

      {view === 'list' ? (
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
