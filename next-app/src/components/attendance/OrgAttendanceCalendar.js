'use client';

import { useEffect, useMemo, useState } from 'react';
import MonthNav from '@/components/MonthNav';
import KpiCard from '@/components/KpiCard';
import AttendanceCalendarMatrix from '@/components/attendance/AttendanceCalendarMatrix';
import { useAttendData } from '@/lib/useAttendData';
import { apiFetch } from '@/lib/apiFetch';
import { perEmployeeStats, onlyStaff, inBdMonth } from '@/lib/attend';

// Order members by employee ID ascending (lowest number first). IDs that are
// missing or non-numeric sort last; name breaks ties.
const byEmployeeId = (a, b) => {
  const na = parseInt(a.employeeId, 10);
  const nb = parseInt(b.employeeId, 10);
  const va = Number.isNaN(na) ? Infinity : na;
  const vb = Number.isNaN(nb) ? Infinity : nb;
  if (va !== vb) return va - vb;
  return (a.name || '').localeCompare(b.name || '');
};

// Self-contained org-wide attendance calendar (month nav + KPI roll-up +
// member × day matrix) for admin/superadmin surfaces. Fetches its own data
// through the admin-gated /api/attenddesk proxy, so it can be dropped into any
// admin page (dashboard tab, attendance page) without extra wiring.
export default function OrgAttendanceCalendar() {
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const { employees, events, leave, loading, error } = useAttendData(
    ['employees', 'attendance', 'leaveRequests'],
    { month: ym },
  );
  const [holidays, setHolidays] = useState([]);

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

  // Staff (employees + IT team + dev), admin accounts excluded — same set the
  // People page manages.
  const stats = useMemo(() => perEmployeeStats(monthEvents), [monthEvents]);
  const members = useMemo(
    () => onlyStaff(employees).sort(byEmployeeId),
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">{members.length} employees this month</p>
        <MonthNav value={ym} onChange={setYm} />
      </div>

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

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
  );
}
