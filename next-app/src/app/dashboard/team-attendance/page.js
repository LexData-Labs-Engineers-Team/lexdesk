'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import MonthNav from '@/components/MonthNav';
import KpiCard from '@/components/KpiCard';
import Avatar from '@/components/Avatar';
import { apiFetch } from '@/lib/apiFetch';
import {
  perEmployeeStats,
  employeeCalendarMonth,
  eventsForUser,
  canonicalDays,
  hhmmInOfficeTz,
  isLateCheckIn,
  fmtTime,
  inBdMonth,
} from '@/lib/attend';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'CHECK_IN', label: 'Check in' },
  { key: 'CHECK_OUT', label: 'Check out' },
  { key: 'late', label: 'Late' },
];
const PAGE_SIZE = 25;

const initials = (name) =>
  (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// Normalize a stored date (plain 'YYYY-MM-DD' or a full ISO timestamp like the
// account createdAt) to the 'YYYY-MM-DD' value an <input type="date"> expects.
const toDateInput = (v) => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

// One member's profile card — shared by the Team Members and Department tabs.
// onEdit opens the edit modal for this member.
function MemberCard({ m, onEdit }) {
  return (
    <div className="card relative flex flex-col items-center text-center !p-0 overflow-hidden">
      {/* ⋮ menu — edit this member's profile */}
      <button
        type="button"
        onClick={() => onEdit(m)}
        className="absolute top-2 right-2 p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-accent-soft)] transition-colors"
        title="Edit profile"
        aria-label={`Edit ${m.name || 'member'}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
      </button>

      {/* Avatar + name + designation */}
      <div className="flex flex-col items-center pt-7 pb-4 px-4">
        <Avatar image={m.photoUrl} initials={initials(m.name)} alt={m.name} className="w-16 h-16 text-base font-bold ring-4 ring-[var(--color-card-border)]" />
        <h3 className="mt-3 text-sm font-semibold text-[var(--color-text-main)]">{m.name || '—'}</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{m.designation || m.teamName || 'Team member'}</p>
      </div>

      {/* Contact */}
      <div className="w-full px-5 py-3 flex flex-col gap-2 text-xs border-t border-[var(--color-card-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
          <span className="truncate text-[var(--color-text-main)]">{m.email || '—'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
          <span className="truncate text-[var(--color-text-main)]">{m.contactNumber || '—'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8" /></svg>
          <span className="truncate text-[var(--color-text-main)]">{fmtDate(m.birthDate)}</span>
        </div>
      </div>

      {/* Employee ID / department / joining — tinted footer */}
      <div className="w-full px-5 py-4 flex flex-col gap-2 text-xs" style={{ background: 'var(--color-accent-soft)' }}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Employee ID</span>
          <span className="font-semibold text-[var(--color-text-main)] font-mono truncate">{m.employeeId || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Department</span>
          <span className="font-semibold text-[var(--color-text-main)] truncate">{m.department || m.teamName || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Date of Joining</span>
          <span className="font-semibold text-[var(--color-text-main)]">{fmtDate(m.joiningDate)}</span>
        </div>
      </div>
    </div>
  );
}

// Calendar-matrix colors, aligned with MonthCalendar / the app palette.
const MATRIX_STYLE = {
  ontime: { bg: 'rgba(34,197,94,0.32)', border: 'rgba(34,197,94,0.55)' },
  late: { bg: 'rgba(234,179,8,0.32)', border: 'rgba(234,179,8,0.6)' },
  holiday: { bg: 'rgba(85,148,248,0.30)', border: 'rgba(85,148,248,0.55)' },
  leave: { bg: 'rgba(239,68,68,0.30)', border: 'rgba(239,68,68,0.55)' },
  missed: { bg: 'rgba(174,61,99,0.32)', border: 'rgba(174,61,99,0.55)' },
  today: { bg: 'rgba(150,150,150,0.14)', border: 'rgba(150,150,150,0.5)' },
  future: { bg: 'transparent', border: 'rgba(150,150,150,0.18)' },
};
const WEEKDAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const MATRIX_LEGEND = [
  { key: 'ontime', label: 'On-time' },
  { key: 'late', label: 'Late' },
  { key: 'leave', label: 'Leave' },
  { key: 'missed', label: 'Missed' },
  { key: 'holiday', label: 'Holiday / off' },
];


// Team lead's view of their members' attendance: month summary table, a
// per-member calendar, and a team-scoped event log. Leadership is enforced
// server-side by /api/team/attendance — this page just renders what it gets.
export default function TeamAttendancePage() {
  const [tab, setTab] = useState('members'); // 'members' | 'attendance'
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [teams, setTeams] = useState([]);
  // Start true so the "not a leader" card never flashes before the first load.
  const [isLeader, setIsLeader] = useState(true);
  const [leave, setLeave] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Manual attendance entry (lead / admin).
  const [showAdd, setShowAdd] = useState(false);
  const [addUid, setAddUid] = useState('');
  const [addType, setAddType] = useState('CHECK_IN');
  const [addDate, setAddDate] = useState('');
  const [addTime, setAddTime] = useState('09:00');
  const [addNote, setAddNote] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState('');
  // Add team member (a lead creates an EMPLOYEE auto-joined to their team).
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberForm, setMemberForm] = useState({ name: '', email: '', employeeId: '', teamId: '', designation: '', department: '', contactNumber: '', birthDate: '', joiningDate: '' });
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberErr, setMemberErr] = useState('');
  const [memberCreated, setMemberCreated] = useState(null); // { email, temporaryPassword }
  // Edit member profile (name, employeeId, designation, contact, dates) via the
  // card's ⋮ menu. Email/team are managed separately and shown read-only.
  const [editTarget, setEditTarget] = useState(null); // the member being edited
  const [editForm, setEditForm] = useState({ name: '', employeeId: '', designation: '', department: '', contactNumber: '', birthDate: '', joiningDate: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      // ±1 day fetch buffer so the Asia/Dhaka offset never clips edge days;
      // the exact month is re-filtered client-side (same as useAttendData).
      const from = new Date(Date.UTC(ym.y, ym.m, 1));
      from.setUTCDate(from.getUTCDate() - 1);
      const to = new Date(Date.UTC(ym.y, ym.m + 1, 1));
      to.setUTCDate(to.getUTCDate() + 1);
      const res = await apiFetch(
        `/api/team/attendance?limit=1000&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEvents(json.events || []);
      setMembers(json.members || []);
      setTeams(json.teams || []);
      setIsLeader(json.isLeader !== false);
      setPage(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  // Calendar overlays: approved leave for the lead's members + org holidays.
  useEffect(() => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      apiFetch('/api/team/leave?status=approved', { headers, cache: 'no-store' }).then((r) => (r.ok ? r.json() : { requests: [] })),
      apiFetch('/api/holidays', { headers, cache: 'no-store' }).then((r) => (r.ok ? r.json() : { holidays: [] })),
    ])
      .then(([l, h]) => { setLeave(l.requests || []); setHolidays(h.holidays || []); })
      .catch(() => {});
  }, []);

  const monthEvents = useMemo(
    () => (events || []).filter((e) => e.timestamp && inBdMonth(e.timestamp, ym.y, ym.m)),
    [events, ym],
  );
  const stats = useMemo(() => perEmployeeStats(monthEvents), [monthEvents]);
  const rows = useMemo(
    () =>
      [...members]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((m) => ({ ...m, ...(stats[m.id] || { presentDays: 0, lateDays: 0, onTimeDays: 0, lastCheckIn: 0 }) })),
    [members, stats],
  );

  // Team-level roll-up for the summary cards (this month).
  const totals = useMemo(
    () =>
      rows.reduce(
        (a, m) => ({
          present: a.present + (m.presentDays || 0),
          late: a.late + (m.lateDays || 0),
          onTime: a.onTime + (m.onTimeDays || 0),
        }),
        { present: 0, late: 0, onTime: 0 },
      ),
    [rows],
  );

  // Full team × day matrix for the calendar grid (one row per member).
  const daysInMonth = useMemo(() => new Date(ym.y, ym.m + 1, 0).getDate(), [ym]);
  const matrix = useMemo(() => {
    const mm = String(ym.m + 1).padStart(2, '0');
    return rows.map((m) => {
      const evs = eventsForUser(monthEvents, m.id);
      const memberLeave = (leave || []).filter((r) => String(r.uid) === String(m.id));
      const cal = employeeCalendarMonth(evs, memberLeave, holidays, ym.y, ym.m);
      const canon = canonicalDays(evs);
      const cells = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const day = cal.days[d] || { status: 'future' };
        const key = `${ym.y}-${mm}-${String(d).padStart(2, '0')}`;
        const ci = canon[key]?.firstCheckIn;
        cells.push({
          d,
          status: day.status,
          time: day.status === 'late' && ci ? hhmmInOfficeTz(ci.ts) : null,
          tip: day.name || day.subject || day.status,
          dow: new Date(ym.y, ym.m, d).getDay(),
        });
      }
      return { member: m, cells };
    });
  }, [rows, monthEvents, leave, holidays, ym, daysInMonth]);

  // Effective selection drives the manual-attendance modal's default member.
  const effectiveUid = useMemo(
    () => (members.some((m) => m.id === selectedUid) ? selectedUid : members[0]?.id || ''),
    [members, selectedUid],
  );

  // Event log — mirrors the admin attendance page, scoped to this team+month.
  const sorted = useMemo(
    () => [...monthEvents].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [monthEvents],
  );
  const filtered = useMemo(() => {
    let list = sorted;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) => (e.user?.name || '').toLowerCase().includes(q) || (e.user?.email || '').toLowerCase().includes(q),
      );
    }
    if (filter === 'late') list = list.filter(isLateCheckIn);
    else if (filter) list = list.filter((e) => e.type === filter);
    return list;
  }, [sorted, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCsv = () => {
    const head = ['Employee', 'Email', 'When', 'Type', 'Status', 'AllChecksPassed', 'Source'];
    const csvRows = filtered.map((e) => [
      e.user?.name || '',
      e.user?.email || '',
      e.timestamp ? new Date(e.timestamp).toISOString() : '',
      e.type,
      isLateCheckIn(e) ? 'late' : e.isEarly ? 'early' : 'on-time',
      e.allChecksPassed === false ? 'no' : 'yes',
      e.clientMode || 'mobile',
    ]);
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head, ...csvRows].map((r) => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `team-attendance-${ym.y}-${String(ym.m + 1).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openAdd = () => {
    setAddErr('');
    setAddUid(effectiveUid || members[0]?.id || '');
    setAddType('CHECK_IN');
    const d = new Date();
    setAddDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    setAddTime('09:00');
    setAddNote('');
    setShowAdd(true);
  };

  const submitManual = async (e) => {
    e.preventDefault();
    setAddErr('');
    if (!addUid) { setAddErr('Pick a team member.'); return; }
    if (!addDate || !addTime) { setAddErr('Date and time are required.'); return; }
    setAddBusy(true);
    try {
      const token = localStorage.getItem('token');
      // Interpret the entered time as office time (Asia/Dhaka = UTC+6, no DST).
      const at = `${addDate}T${addTime}:00+06:00`;
      const res = await fetch('/api/team/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uid: addUid, type: addType, at, note: addNote.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setShowAdd(false);
      await load();
    } catch (e2) {
      setAddErr(e2.message);
    } finally {
      setAddBusy(false);
    }
  };

  const openAddMember = () => {
    setMemberErr('');
    setMemberCreated(null);
    setMemberForm({ name: '', email: '', employeeId: '', teamId: teams[0]?.id || '', designation: '', department: '', contactNumber: '', birthDate: '', joiningDate: '' });
    setShowAddMember(true);
  };

  const submitAddMember = async (e) => {
    e.preventDefault();
    setMemberErr('');
    if (!memberForm.name.trim() || !memberForm.email.trim()) {
      setMemberErr('Name and email are required.');
      return;
    }
    setMemberBusy(true);
    try {
      const token = localStorage.getItem('token');
      // teamId is optional when leading one team (the server auto-assigns it);
      // sent explicitly only when the lead picks among several teams.
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: memberForm.name.trim(),
          email: memberForm.email.trim(),
          employeeId: memberForm.employeeId.trim() || null,
          teamId: memberForm.teamId || null,
          designation: memberForm.designation.trim() || null,
          department: memberForm.department.trim() || null,
          contactNumber: memberForm.contactNumber.trim() || null,
          birthDate: memberForm.birthDate || null,
          joiningDate: memberForm.joiningDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const emp = json.employee || {};
      setMemberCreated({ email: emp.email || memberForm.email.trim(), temporaryPassword: emp.temporaryPassword || '' });
      await load();
    } catch (e2) {
      setMemberErr(e2.message);
    } finally {
      setMemberBusy(false);
    }
  };

  const closeAddMember = () => {
    setShowAddMember(false);
    setMemberCreated(null);
    setMemberErr('');
  };

  const openEdit = (m) => {
    setEditErr('');
    setEditForm({
      name: m.name || '',
      employeeId: m.employeeId || '',
      designation: m.designation || '',
      department: m.department || '',
      contactNumber: m.contactNumber || '',
      birthDate: toDateInput(m.birthDate),
      joiningDate: toDateInput(m.joiningDate),
    });
    setEditTarget(m);
  };
  const closeEdit = () => { setEditTarget(null); setEditErr(''); };

  const submitEdit = async (e) => {
    e.preventDefault();
    setEditErr('');
    if (!editForm.name.trim()) { setEditErr('Name is required.'); return; }
    setEditBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/team/member/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: editForm.name.trim(),
          employeeId: editForm.employeeId.trim() || null,
          designation: editForm.designation.trim() || null,
          department: editForm.department.trim() || null,
          contactNumber: editForm.contactNumber.trim() || null,
          birthDate: editForm.birthDate || null,
          joiningDate: editForm.joiningDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditTarget(null);
      await load();
    } catch (e2) {
      setEditErr(e2.message);
    } finally {
      setEditBusy(false);
    }
  };

  const addInputCls =
    'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team Attendance"
        subtitle={isLeader ? `${members.length} team member${members.length === 1 ? '' : 's'}` : 'Your team at a glance'}
        actions={
          <div className="flex items-center gap-2">
            {(tab === 'attendance' || tab === 'activity') && <MonthNav value={ym} onChange={setYm} />}
            {isLeader && tab === 'members' && (
              <button onClick={openAddMember} className="btn-primary py-2 px-4 text-sm">+ Add member</button>
            )}
            {isLeader && tab === 'attendance' && members.length > 0 && (
              <button onClick={openAdd} className="btn-outline py-2 px-4 text-sm">+ Add attendance</button>
            )}
            <button onClick={load} className="btn-outline py-2 px-4 text-sm">Refresh</button>
          </div>
        }
      />

      {/* Tab switcher */}
      <div className="inline-flex p-1 rounded-xl bg-[var(--color-card-bg)] border border-[var(--color-card-border)] gap-1 self-start">
        {[
          { key: 'members', label: 'Team Members' },
          { key: 'attendance', label: 'Team Attendance' },
          { key: 'activity', label: 'Activity log' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowAdd(false)}>
          <form onSubmit={submitManual} onClick={(e) => e.stopPropagation()} className="card glossy w-full max-w-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Add attendance</h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] -mt-2">Manual entries count as verified attendance and are tagged as manually added.</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Team member</label>
              <select value={addUid} onChange={(e) => setAddUid(e.target.value)} className={addInputCls}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Type</label>
                <select value={addType} onChange={(e) => setAddType(e.target.value)} className={addInputCls}>
                  <option value="CHECK_IN">Check in</option>
                  <option value="CHECK_OUT">Check out</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Date</label>
                <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} className={addInputCls} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Time</label>
                <input type="time" value={addTime} onChange={(e) => setAddTime(e.target.value)} className={addInputCls} required />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Note (optional)</label>
              <input type="text" maxLength={200} value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="e.g. Forgot to check in" className={addInputCls} />
            </div>
            {addErr && <p className="text-sm text-[var(--color-red)]">{addErr}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-outline py-2 px-4 text-sm">Cancel</button>
              <button type="submit" disabled={addBusy} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{addBusy ? 'Adding…' : 'Add attendance'}</button>
            </div>
          </form>
        </div>
      )}

      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeAddMember}>
          <div className="card glossy w-full max-w-lg flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Add team member</h2>
              <button onClick={closeAddMember} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>

            {memberCreated ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-[var(--color-green)]">Employee created and added to your team. Share these sign-in details — they must change the password on first login.</p>
                <div className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg p-3 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Email</span><span className="text-[var(--color-text-main)]">{memberCreated.email}</span></div>
                  <div className="flex justify-between gap-3 mt-1"><span className="text-[var(--color-text-muted)]">Temp password</span><span className="text-[var(--color-text-main)] font-mono">{memberCreated.temporaryPassword || '—'}</span></div>
                </div>
                <div className="flex justify-end">
                  <button onClick={closeAddMember} className="btn-primary py-2 px-5 text-sm">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submitAddMember} className="flex flex-col gap-4">
                <p className="text-xs text-[var(--color-text-muted)] -mt-1">New members join {teams.length > 1 ? 'the team you pick below' : 'your team'} and get a temporary password to share.</p>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Full name</label>
                  <input type="text" maxLength={120} value={memberForm.name} onChange={(e) => setMemberForm((f) => ({ ...f, name: e.target.value }))} className={addInputCls} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">Email</label>
                  <input type="email" value={memberForm.email} onChange={(e) => setMemberForm((f) => ({ ...f, email: e.target.value }))} className={addInputCls} required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Employee ID</label>
                    <input type="text" maxLength={50} value={memberForm.employeeId} onChange={(e) => setMemberForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder="e.g. 700036 (optional)" className={addInputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Designation</label>
                    <input type="text" maxLength={80} value={memberForm.designation} onChange={(e) => setMemberForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Software Engineer" className={addInputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Department</label>
                    <input type="text" maxLength={80} value={memberForm.department} onChange={(e) => setMemberForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Engineering" className={addInputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Contact number</label>
                    <input type="tel" maxLength={30} value={memberForm.contactNumber} onChange={(e) => setMemberForm((f) => ({ ...f, contactNumber: e.target.value }))} placeholder="e.g. +880 1XXX-XXXXXX" className={addInputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Date of joining</label>
                    <input type="date" value={memberForm.joiningDate} onChange={(e) => setMemberForm((f) => ({ ...f, joiningDate: e.target.value }))} className={addInputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Date of birth</label>
                    <input type="date" value={memberForm.birthDate} onChange={(e) => setMemberForm((f) => ({ ...f, birthDate: e.target.value }))} className={addInputCls} />
                  </div>
                </div>
                {teams.length > 1 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--color-text-muted)]">Team</label>
                    <select value={memberForm.teamId} onChange={(e) => setMemberForm((f) => ({ ...f, teamId: e.target.value }))} className={addInputCls}>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                {memberErr && <p className="text-sm text-[var(--color-red)]">{memberErr}</p>}
                <div className="flex gap-2 justify-end pt-1">
                  <button type="button" onClick={closeAddMember} className="btn-outline py-2 px-4 text-sm">Cancel</button>
                  <button type="submit" disabled={memberBusy} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{memberBusy ? 'Creating…' : 'Create employee'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeEdit}>
          <form onSubmit={submitEdit} onClick={(e) => e.stopPropagation()} className="card glossy w-full max-w-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Edit member</h2>
              <button type="button" onClick={closeEdit} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] -mt-2">Update {editTarget.name || 'this member'}&apos;s profile. Email and team are managed separately.</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Full name</label>
              <input type="text" maxLength={120} value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className={addInputCls} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Email address</label>
              <input type="email" value={editTarget.email || ''} readOnly disabled className={`${addInputCls} opacity-60 cursor-not-allowed`} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Employee ID</label>
                <input type="text" maxLength={50} value={editForm.employeeId} onChange={(e) => setEditForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder="e.g. 700036" className={addInputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Designation</label>
                <input type="text" maxLength={80} value={editForm.designation} onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Software Engineer" className={addInputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Department</label>
                <input type="text" maxLength={80} value={editForm.department} onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Engineering" className={addInputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Contact number</label>
                <input type="tel" maxLength={30} value={editForm.contactNumber} onChange={(e) => setEditForm((f) => ({ ...f, contactNumber: e.target.value }))} placeholder="e.g. +880 1XXX-XXXXXX" className={addInputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Date of joining</label>
                <input type="date" value={editForm.joiningDate} onChange={(e) => setEditForm((f) => ({ ...f, joiningDate: e.target.value }))} className={addInputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Date of birth</label>
                <input type="date" value={editForm.birthDate} onChange={(e) => setEditForm((f) => ({ ...f, birthDate: e.target.value }))} className={addInputCls} />
              </div>
            </div>
            {editErr && <p className="text-sm text-[var(--color-red)]">{editErr}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={closeEdit} className="btn-outline py-2 px-4 text-sm">Cancel</button>
              <button type="submit" disabled={editBusy} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">{editBusy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        </div>
      )}

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      {!loading && !isLeader ? (
        <div className="card text-sm text-[var(--color-text-muted)]">
          You don&apos;t lead a team yet. When an admin makes you a team leader, your team&apos;s attendance appears here.
        </div>
      ) : tab === 'members' ? (
        <div className="flex flex-col gap-4">
          {loading && !rows.length && (
            <div className="card text-sm text-[var(--color-text-muted)]">Loading…</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rows.map((m) => (
              <MemberCard key={m.id} m={m} onEdit={openEdit} />
            ))}
          </div>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">No members in your team yet — add your first one above.</p>
          )}
        </div>
      ) : tab === 'attendance' ? (
        <div className="flex flex-col gap-6">
          {/* Month roll-up — quick visual read before the matrix. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Team members" value={rows.length} color="purple" />
            <KpiCard
              label="Present days"
              value={totals.present}
              color="green"
              icon={<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            />
            <KpiCard
              label="On-time days"
              value={totals.onTime}
              color="blue"
              icon={<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeWidth="2" /><path strokeWidth="2" strokeLinecap="round" d="M12 7v5l3 2" /></svg>}
            />
            <KpiCard
              label="Late days"
              value={totals.late}
              color="yellow"
              icon={<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86l-8.1 14A1 1 0 003 19.5h18a1 1 0 00.87-1.5l-8.1-14a1 1 0 00-1.74 0z" /></svg>}
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--color-text-main)]">
                Attendance calendar · {new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                {MATRIX_LEGEND.map((l) => (
                  <span key={l.key} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-[3px]"
                      style={{ background: MATRIX_STYLE[l.key].bg, border: `1px solid ${MATRIX_STYLE[l.key].border}` }}
                    />
                    <span className="text-[var(--color-text-muted)]">{l.label}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-card-border)]">
                      <th className="sticky left-0 z-10 bg-[var(--color-card-bg)] text-left px-3 py-2 font-medium text-[var(--color-text-muted)] border-r border-[var(--color-card-border)] min-w-[170px]">
                        Member
                      </th>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                        const dow = new Date(ym.y, ym.m, d).getDay();
                        const off = dow === 5 || dow === 6; // Fri & Sat weekly off
                        return (
                          <th key={d} className="px-1 py-1.5 text-center font-medium" style={{ minWidth: 42 }}>
                            <div className={off ? 'text-[var(--color-blue)]' : 'text-[var(--color-text-main)]'}>{d}</div>
                            <div className="text-[9px] text-[var(--color-text-muted)]">{WEEKDAY_INITIAL[dow]}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.length === 0 && (
                      <tr>
                        <td colSpan={daysInMonth + 1} className="py-8 text-center text-[var(--color-text-muted)]">
                          {loading ? 'Loading…' : 'No members in your team yet.'}
                        </td>
                      </tr>
                    )}
                    {matrix.map(({ member, cells }) => (
                      <tr key={member.id} className="border-t border-[var(--color-card-border)]">
                        <td className="sticky left-0 z-10 bg-[var(--color-card-bg)] px-3 py-1.5 border-r border-[var(--color-card-border)]">
                          <div className="flex items-center gap-2">
                            <Avatar image={member.photoUrl} initials={initials(member.name)} alt={member.name} className="w-7 h-7 text-[10px] font-semibold shrink-0" />
                            <span className="text-[var(--color-text-main)] font-medium truncate max-w-[120px]">{member.name || '—'}</span>
                          </div>
                        </td>
                        {cells.map((c) => {
                          const st = MATRIX_STYLE[c.status] || MATRIX_STYLE.future;
                          return (
                            <td key={c.d} title={c.tip} className="p-0.5 align-middle">
                              <div
                                className="rounded-[5px] h-9 flex items-center justify-center text-[9px] font-semibold leading-none text-[var(--color-text-main)] px-0.5 text-center"
                                style={{ background: st.bg, border: `1px solid ${st.border}` }}
                              >
                                {c.time || ''}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <h2 className="text-base font-semibold text-[var(--color-text-main)]">Activity log · {new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <div className="card flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by member…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="flex-1 min-w-[200px] bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]"
            />
            <div className="flex gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => { setFilter(f.key); setPage(1); }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                    filter === f.key
                      ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]'
                      : 'bg-[var(--color-card-bg)] text-[var(--color-text-muted)] border border-[var(--color-card-border)] hover:text-[var(--color-text-main)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button onClick={exportCsv} disabled={!filtered.length} className="btn-outline py-2 px-3 text-xs disabled:opacity-50">
              Export CSV
            </button>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                    <th className="py-3 px-4 font-medium">Employee</th>
                    <th className="py-3 px-4 font-medium">When</th>
                    <th className="py-3 px-4 font-medium">Type</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !pageRows.length && (
                    <tr><td colSpan={5} className="py-8 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
                  )}
                  {!loading && pageRows.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-[var(--color-text-muted)]">No events match the current filters.</td></tr>
                  )}
                  {pageRows.map((e) => (
                    <tr key={e.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02]">
                      <td className="py-2.5 px-4">
                        <div className="text-[var(--color-text-main)]">{e.user?.name || '—'}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{e.user?.email}</div>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">{fmtTime(new Date(e.timestamp).getTime())}</td>
                      <td className="py-2.5 px-4">{e.type === 'CHECK_IN' ? 'Check in' : e.type === 'CHECK_OUT' ? 'Check out' : e.type}</td>
                      <td className="py-2.5 px-4">
                        {isLateCheckIn(e) ? <span className="text-[var(--color-yellow)]">Late</span> : e.isEarly ? <span className="text-[var(--color-blue)]">Early</span> : <span className="text-[var(--color-green)]">On time</span>}
                        {e.allChecksPassed === false && <span className="text-[var(--color-red)] ml-2">checks failed</span>}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-[var(--color-text-muted)]">{e.clientMode || 'mobile'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between p-4 border-t border-[var(--color-card-border)] text-xs text-[var(--color-text-muted)]">
              <span>Page {page} of {totalPages} · {filtered.length} events</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-outline py-1 px-3 disabled:opacity-30">Prev</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-outline py-1 px-3 disabled:opacity-30">Next</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
