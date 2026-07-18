'use client';

import { useMemo, useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import MonthCalendar from '@/components/MonthCalendar';
import { useAttendData } from '@/lib/useAttendData';
import { employeeCalendarMonth, eventsForUser, onlyEmployees } from '@/lib/attend';
import { apiFetch } from '@/lib/apiFetch';

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarPage() {
  const [selected, setSelected] = useState('');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-11
  const { employees, events, leave, loading, error, refresh } = useAttendData(['employees', 'attendance', 'leaveRequests'], { month: { y: year, m: month } });
  const [holidays, setHolidays] = useState([]);

  const staff = useMemo(() => onlyEmployees(employees), [employees]);

  useEffect(() => {
    if (!selected && staff.length) setSelected(staff[0].id);
  }, [staff, selected]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    apiFetch('/api/holidays', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { holidays: [] }))
      .then((j) => setHolidays(j.holidays || []))
      .catch(() => setHolidays([]));
  }, []);

  const employee = useMemo(() => staff.find((e) => e.id === selected) || null, [staff, selected]);

  const cal = useMemo(() => {
    if (!selected) return null;
    const mine = eventsForUser(events, selected);
    const myLeave = (leave || []).filter((r) => String(r.uid) === String(selected));
    return employeeCalendarMonth(mine, myLeave, holidays, year, month);
  }, [events, leave, holidays, selected, year, month]);

  const prevMonth = () => { const d = new Date(year, month - 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };
  const nextMonth = () => { const d = new Date(year, month + 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };

  const monthLabel = `${MONTH_FULL[month]} ${year}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Calendar"
        subtitle={employee ? `${employee.name} · ${monthLabel}` : 'Select an employee'}
        actions={<button onClick={refresh} className="btn-outline py-2 px-4 text-sm">Refresh</button>}
      />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <div className="card flex flex-wrap items-center gap-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 min-w-[220px] bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)]"
        >
          <option value="">Select employee…</option>
          {staff.map((e) => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="btn-outline py-2 px-3 text-sm">←</button>
          <span className="text-sm font-semibold text-[var(--color-text-main)] min-w-[150px] text-center">{monthLabel}</span>
          <button onClick={nextMonth} className="btn-outline py-2 px-3 text-sm">→</button>
        </div>
      </div>

      {loading && !staff.length && <div className="card text-[var(--color-text-muted)] text-sm">Loading…</div>}

      {employee && cal && <MonthCalendar cal={cal} loading={loading} />}

      {!loading && staff.length === 0 && (
        <div className="card text-[var(--color-text-muted)] text-sm text-center py-12">No employees found.</div>
      )}
    </div>
  );
}
