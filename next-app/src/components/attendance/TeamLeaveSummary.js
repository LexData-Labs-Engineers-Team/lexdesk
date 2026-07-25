'use client';

import { useEffect, useMemo, useState } from 'react';
import Avatar from '@/components/Avatar';
import { apiFetch } from '@/lib/apiFetch';
import { eventsForUser, leaveDaysByMonth, lateEarlyDaysByMonth } from '@/lib/attend';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One sub-row per employee, in image order (Work from Home intentionally omitted).
// `source` picks where each row's numbers come from: approved leave requests of a
// given type, or attendance-derived early/late day counts.
const TYPE_ROWS = [
  { key: 'Casual', label: 'Casual', source: 'leave', type: 'Casual' },
  { key: 'Sick', label: 'Sick', source: 'leave', type: 'Sick' },
  { key: 'Early Leave', label: 'Early Leave', source: 'early' },
  { key: 'Late', label: 'Late', source: 'late' },
];

const initials = (name) =>
  (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// ID-ascending (numeric, missing/non-numeric last, name breaks ties) — the table
// leads with the ID column, so it should read in ID order regardless of caller.
const byEmployeeId = (a, b) => {
  const na = parseInt(a.employeeId, 10);
  const nb = parseInt(b.employeeId, 10);
  const va = Number.isNaN(na) ? Infinity : na;
  const vb = Number.isNaN(nb) ? Infinity : nb;
  if (va !== vb) return va - vb;
  return (a.name || '').localeCompare(b.name || '');
};

// Default attendance source: the team-lead endpoint. Admin/superadmin surfaces
// pass an org-wide builder instead. Both take (fromISO, toISO) and return { events }.
const teamAttendanceUrl = (fromISO, toISO) =>
  `/api/team/attendance?limit=1000&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`;

// Yearly per-employee leave / early-leave / late summary, broken down by month.
// Leave counts come from approved requests; early/late come from attendance.
// Attendance is fetched here month-by-month to stay under the API's 1000-event
// window cap (a single yearly window would clip a busy team).
export default function TeamLeaveSummary({ members, leave, holidays, year, onYearChange, buildAttendanceUrl = teamAttendanceUrl }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        const headers = { Authorization: `Bearer ${token}` };
        // ±1 day buffer per month so the Asia/Dhaka offset never clips edge days.
        const reqs = Array.from({ length: 12 }, (_, m) => {
          const from = new Date(Date.UTC(year, m, 1));
          from.setUTCDate(from.getUTCDate() - 1);
          const to = new Date(Date.UTC(year, m + 1, 1));
          to.setUTCDate(to.getUTCDate() + 1);
          return apiFetch(buildAttendanceUrl(from.toISOString(), to.toISOString()), { headers, cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : { events: [] }));
        });
        const results = await Promise.all(reqs);
        if (cancelled) return;
        // Overlapping windows can repeat edge events — dedupe by id.
        const byId = new Map();
        for (const res of results) for (const e of res.events || []) byId.set(e.id, e);
        setEvents([...byId.values()]);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year, buildAttendanceUrl]);

  const rows = useMemo(
    () =>
      [...(members || [])].sort(byEmployeeId).map((m) => {
        const byType = leaveDaysByMonth(
          (leave || []).filter((r) => String(r.uid) === String(m.id)),
          holidays,
          year,
        );
        const { late, early } = lateEarlyDaysByMonth(eventsForUser(events, m.id), year);
        const seriesFor = (row) => {
          if (row.source === 'leave') return byType[row.type] || new Array(12).fill(0);
          if (row.source === 'early') return early;
          return late;
        };
        const series = TYPE_ROWS.map((row) => ({ row, months: seriesFor(row) }));
        return { member: m, series };
      }),
    [members, leave, holidays, year, events],
  );

  const cellCls = 'px-2 py-1.5 text-center tabular-nums';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-main)]">Team leave summary · {year}</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => onYearChange(year - 1)} className="btn-outline py-1.5 px-3 text-sm" aria-label="Previous year">‹</button>
          <span className="text-sm font-semibold text-[var(--color-text-main)] min-w-[3.5rem] text-center">{year}</span>
          <button onClick={() => onYearChange(year + 1)} className="btn-outline py-1.5 px-3 text-sm" aria-label="Next year">›</button>
        </div>
      </div>

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs w-full">
            <thead>
              <tr className="border-b border-[var(--color-card-border)] text-[var(--color-text-muted)]">
                <th className="sticky left-0 z-10 bg-[var(--color-card-bg)] text-left px-3 py-2 font-medium border-r border-[var(--color-card-border)]" style={{ width: 90, minWidth: 90 }}>
                  ID
                </th>
                <th className="sticky z-10 bg-[var(--color-card-bg)] text-left px-3 py-2 font-medium border-r border-[var(--color-card-border)] min-w-[160px]" style={{ left: 90 }}>
                  Employee
                </th>
                <th className="text-left px-3 py-2 font-medium border-r border-[var(--color-card-border)] min-w-[90px]">Type</th>
                {MONTHS.map((mo) => (
                  <th key={mo} className="px-2 py-2 text-center font-medium" style={{ minWidth: 40 }}>{mo}</th>
                ))}
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--color-card-border)] text-[var(--color-text-main)]" style={{ minWidth: 56 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={MONTHS.length + 4} className="py-8 text-center text-[var(--color-text-muted)]">
                    {loading ? 'Loading…' : 'No members in your team yet.'}
                  </td>
                </tr>
              )}
              {rows.map(({ member, series }) =>
                series.map(({ row, months }, i) => (
                  <tr
                    key={`${member.id}-${row.key}`}
                    className={i === 0 ? 'border-t-2 border-[var(--color-card-border)]' : 'border-t border-[var(--color-card-border)]/60'}
                  >
                    {i === 0 && (
                      <>
                        <td rowSpan={series.length} className="sticky left-0 z-10 bg-[var(--color-card-bg)] px-3 py-1.5 border-r border-[var(--color-card-border)] align-top" style={{ width: 90, minWidth: 90 }}>
                          <span className="text-[var(--color-text-muted)] font-mono">{member.employeeId || '—'}</span>
                        </td>
                        <td rowSpan={series.length} className="sticky z-10 bg-[var(--color-card-bg)] px-3 py-1.5 border-r border-[var(--color-card-border)] align-top" style={{ left: 90 }}>
                          <div className="flex items-center gap-2">
                            <Avatar image={member.photoUrl} initials={initials(member.name)} alt={member.name} className="w-7 h-7 text-[10px] font-semibold shrink-0" />
                            <span className="text-[var(--color-text-main)] font-medium truncate max-w-[130px]">{member.name || '—'}</span>
                          </div>
                        </td>
                      </>
                    )}
                    <td className="px-3 py-1.5 text-[var(--color-text-main)] border-r border-[var(--color-card-border)] whitespace-nowrap">{row.label}</td>
                    {months.map((n, mi) => (
                      <td key={mi} className={`${cellCls} ${n ? 'text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)]'}`}>{n}</td>
                    ))}
                    <td className="px-3 py-1.5 text-center font-semibold tabular-nums border-l border-[var(--color-card-border)] text-[var(--color-text-main)]">{sum(months)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
