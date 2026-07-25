'use client';

import { useEffect, useMemo, useState } from 'react';
import TeamLeaveSummary from '@/components/attendance/TeamLeaveSummary';
import { useAttendData } from '@/lib/useAttendData';
import { apiFetch } from '@/lib/apiFetch';
import { onlyStaff } from '@/lib/attend';

// Org-wide attendance source for the yearly leave summary, via the admin-gated
// proxy. Matches TeamLeaveSummary's (fromISO, toISO) → { events } contract.
const orgAttendanceUrl = (fromISO, toISO) =>
  `/api/attenddesk?resource=attendance&limit=1000&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`;

// Self-contained org-wide Team Leave summary (yearly, per-employee) for the
// admin/superadmin dashboard — mirrors OrgAttendanceCalendar's wiring. Employees
// + leave come from the proxy here; TeamLeaveSummary fetches attendance itself.
export default function OrgTeamLeaveSummary() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { employees, leave } = useAttendData(['employees', 'leaveRequests']);
  const [holidays, setHolidays] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    apiFetch('/api/holidays', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { holidays: [] }))
      .then((j) => setHolidays(j.holidays || []))
      .catch(() => {});
  }, []);

  const members = useMemo(() => onlyStaff(employees), [employees]);

  return (
    <TeamLeaveSummary
      members={members}
      leave={leave}
      holidays={holidays}
      year={year}
      onYearChange={setYear}
      buildAttendanceUrl={orgAttendanceUrl}
    />
  );
}
