'use client';

import { useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import MonthNav from '@/components/MonthNav';
import KpiCard from '@/components/KpiCard';
import AttendanceCalendarMatrix from '@/components/attendance/AttendanceCalendarMatrix';
import { useAttendData } from '@/lib/useAttendData';
import { apiFetch } from '@/lib/apiFetch';
import { fmtTime, isLateCheckIn, perEmployeeStats, onlyStaff, inBdMonth } from '@/lib/attend';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'CHECK_IN', label: 'Check in' },
  { key: 'CHECK_OUT', label: 'Check out' },
  { key: 'late', label: 'Late' },
];
const PAGE_SIZE = 25;

export default function AttendancePage() {
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  // Month-scoped org-wide fetch: employees + events + leave (for the calendar).
  const { employees, events, leave, loading, error, refresh } = useAttendData(
    ['employees', 'attendance', 'leaveRequests'],
    { month: ym },
  );
  const [holidays, setHolidays] = useState([]);
  const [tab, setTab] = useState('calendar');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);

  // Holiday overlay for the calendar matrix.
  useEffect(() => {
    const token = localStorage.getItem('token');
    apiFetch('/api/holidays', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { holidays: [] }))
      .then((j) => setHolidays(j.holidays || []))
      .catch(() => {});
  }, []);

  const monthEvents = useMemo(
    () => (events || []).filter((e) => e.timestamp && inBdMonth(e.timestamp, ym.y, ym.m)),
    [events, ym],
  );

  // Calendar rows: staff (employees + IT team + dev), admin accounts excluded —
  // same set the People page manages.
  const stats = useMemo(() => perEmployeeStats(monthEvents), [monthEvents]);
  const members = useMemo(
    () => onlyStaff(employees).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [employees],
  );
  const totals = useMemo(
    () =>
      members.reduce(
        (a, m) => {
          const s = stats[m.id] || {};
          return {
            present: a.present + (s.presentDays || 0),
            late: a.late + (s.lateDays || 0),
            onTime: a.onTime + (s.onTimeDays || 0),
          };
        },
        { present: 0, late: 0, onTime: 0 },
      ),
    [members, stats],
  );
  const approvedLeave = useMemo(() => (leave || []).filter((r) => r.status === 'approved'), [leave]);

  const sorted = useMemo(
    () => [...monthEvents].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [monthEvents],
  );

  // Recent activity = the latest handful of events, regardless of filters.
  const recent = useMemo(() => sorted.slice(0, 12), [sorted]);

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
    const rows = filtered.map((e) => [
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
    const csv = [head, ...rows].map((r) => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${ym.y}-${String(ym.m + 1).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        subtitle={tab === 'calendar' ? `${members.length} employees` : tab === 'events' ? `${filtered.length} events` : 'Latest check-in / check-out activity'}
        actions={
          <div className="flex items-center gap-2">
            <MonthNav value={ym} onChange={setYm} />
            <button onClick={refresh} className="btn-outline py-2 px-4 text-sm">Refresh</button>
          </div>
        }
      />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <div className="card flex flex-wrap items-center gap-2">
        {[
          { key: 'calendar', label: 'Calendar' },
          { key: 'events', label: 'Events' },
          { key: 'recent', label: 'Recent activity' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${
              tab === t.key
                ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]'
                : 'btn-outline'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calendar' ? (
        <div className="flex flex-col gap-6">
          {/* Month roll-up — quick visual read before the matrix. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Team members" value={members.length} color="purple" />
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

          <AttendanceCalendarMatrix
            members={members}
            events={monthEvents}
            leave={approvedLeave}
            holidays={holidays}
            ym={ym}
            loading={loading}
            emptyText="No employees yet."
          />
        </div>
      ) : tab === 'events' ? (
        <>
          <div className="card flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by employee…"
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
        </>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="px-5 py-4 border-b border-[var(--color-card-border)]">
            <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Recent activity</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                  <th className="py-3 px-5 font-medium">Employee</th>
                  <th className="py-3 px-5 font-medium">When</th>
                  <th className="py-3 px-5 font-medium">Type</th>
                  <th className="py-3 px-5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && !recent.length && (
                  <tr><td colSpan={4} className="py-8 text-center text-[var(--color-text-muted)]">Loading…</td></tr>
                )}
                {!loading && recent.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-[var(--color-text-muted)]">No recent activity.</td></tr>
                )}
                {recent.map((e) => (
                  <tr key={e.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02]">
                    <td className="py-3 px-5 text-[var(--color-text-main)]">{e.user?.name || e.user?.email || '—'}</td>
                    <td className="py-3 px-5 whitespace-nowrap">{fmtTime(new Date(e.timestamp).getTime())}</td>
                    <td className="py-3 px-5">{e.type === 'CHECK_IN' ? 'Check in' : e.type === 'CHECK_OUT' ? 'Check out' : e.type}</td>
                    <td className="py-3 px-5">
                      {isLateCheckIn(e) ? <span className="text-[var(--color-yellow)]">Late</span> : <span className="text-[var(--color-green)]">On time</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
