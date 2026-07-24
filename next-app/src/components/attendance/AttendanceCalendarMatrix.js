'use client';

import { useMemo } from 'react';
import Avatar from '@/components/Avatar';
import {
  eventsForUser,
  employeeCalendarMonth,
  canonicalDays,
  hhmmInOfficeTz,
} from '@/lib/attend';

// Calendar-matrix colors, aligned with MonthCalendar / the app palette.
const MATRIX_STYLE = {
  ontime: { bg: 'rgba(34,197,94,0.32)', border: 'rgba(34,197,94,0.55)' },
  allowance: { bg: '#CCF0BA', border: 'rgba(120,190,110,0.85)' },
  late: { bg: 'rgba(234,179,8,0.32)', border: 'rgba(234,179,8,0.6)' },
  holiday: { bg: 'rgba(85,148,248,0.30)', border: 'rgba(85,148,248,0.55)' },
  leave: { bg: 'rgba(239,68,68,0.30)', border: 'rgba(239,68,68,0.55)' },
  halfleave: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)' },
  missed: { bg: '#FFF3F2', border: 'rgba(200,95,75,0.55)' },
  today: { bg: 'rgba(150,150,150,0.14)', border: 'rgba(150,150,150,0.5)' },
  future: { bg: 'transparent', border: 'rgba(150,150,150,0.18)' },
};
const WEEKDAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Grace window (office time, inclusive): a late check-in up to this time is shown
// as "Late allowance" rather than "Late". Purely a display distinction here —
// day-based late counts (KPIs) still follow the canonical Android rule.
const LATE_ALLOWANCE_UNTIL = '09:15';

// Short in-cell label per approved leave type (long names would overflow the box).
const LEAVE_LABEL = { Sick: 'Sick', Casual: 'Casual', Emergency: 'Emrg', 'Half Day': 'Half' };

// Half-day period → in-cell label. First half off = leaves early ("Early"),
// second half off = comes back late / leaves for the tail of the day ("Late").
const HALF_LABEL = { first: 'Early', second: 'Late' };

const MATRIX_LEGEND = [
  { key: 'ontime', label: 'On-time' },
  { key: 'allowance', label: 'Late allowance' },
  { key: 'late', label: 'Late' },
  { key: 'leave', label: 'Leave' },
  { key: 'halfleave', label: 'Half day' },
  { key: 'missed', label: 'Missed' },
  { key: 'holiday', label: 'Holiday / off' },
];

const initials = (name) =>
  (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

// Member × day attendance grid for one month, shared by the team-lead and admin
// attendance pages. Who appears (a team vs. the whole org) is the caller's
// concern — this renders `members` against their `events` for the `ym` month.
// `leave` should already be filtered to approved requests.
export default function AttendanceCalendarMatrix({ members, events, leave, holidays, ym, loading, emptyText = 'No members yet.' }) {
  const daysInMonth = useMemo(() => new Date(ym.y, ym.m + 1, 0).getDate(), [ym]);

  // Full members × day matrix (one row per member).
  const matrix = useMemo(() => {
    const mm = String(ym.m + 1).padStart(2, '0');
    return (members || []).map((m) => {
      const evs = eventsForUser(events, m.id);
      const memberLeave = (leave || []).filter((r) => String(r.uid) === String(m.id));
      const cal = employeeCalendarMonth(evs, memberLeave, holidays, ym.y, ym.m);
      const canon = canonicalDays(evs);
      const cells = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const day = cal.days[d] || { status: 'future' };
        const key = `${ym.y}-${mm}-${String(d).padStart(2, '0')}`;
        const ci = canon[key]?.firstCheckIn;
        const ciHhmm = ci ? hhmmInOfficeTz(ci.ts) : null;
        // A late check-in within the grace window renders as "Late allowance".
        let status = day.status;
        if (status === 'late' && ciHhmm && ciHhmm <= LATE_ALLOWANCE_UNTIL) status = 'allowance';
        // A half-day leave gets its own lighter shade + early/late label.
        else if (status === 'leave' && day.leaveType === 'Half Day') status = 'halfleave';
        const showTime = status === 'late' || status === 'allowance';
        // In-cell text: check-in time for late/allowance, leave type for leave days.
        let text = null;
        if (showTime) text = ciHhmm;
        else if (status === 'leave') text = LEAVE_LABEL[day.leaveType] || 'Leave';
        else if (status === 'halfleave') text = HALF_LABEL[day.halfDayPeriod] || 'Half';
        cells.push({
          d,
          status,
          text,
          tip:
            status === 'ontime' && ciHhmm
              ? `On-time · arrived ${ciHhmm}`
              : status === 'allowance'
              ? `Late allowance · ${ciHhmm}`
              : status === 'halfleave'
                ? `Half day${HALF_LABEL[day.halfDayPeriod] ? ` · ${HALF_LABEL[day.halfDayPeriod]} leave` : ''}${day.subject ? ` · ${day.subject}` : ''}`
                : status === 'leave'
                  ? `${day.leaveType ? `${day.leaveType} leave` : 'Leave'}${day.subject ? ` · ${day.subject}` : ''}`
                  : (day.name || day.subject || day.status),
        });
      }
      return { member: m, cells };
    });
  }, [members, events, leave, holidays, ym, daysInMonth]);

  return (
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
                <th className="sticky left-0 z-10 bg-[var(--color-card-bg)] text-left px-3 py-2 font-medium text-[var(--color-text-muted)] border-r border-[var(--color-card-border)]" style={{ width: 90, minWidth: 90 }}>
                  ID
                </th>
                <th className="sticky z-10 bg-[var(--color-card-bg)] text-left px-3 py-2 font-medium text-[var(--color-text-muted)] border-r border-[var(--color-card-border)] min-w-[170px]" style={{ left: 90 }}>
                  Employee
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
                  <td colSpan={daysInMonth + 2} className="py-8 text-center text-[var(--color-text-muted)]">
                    {loading ? 'Loading…' : emptyText}
                  </td>
                </tr>
              )}
              {matrix.map(({ member, cells }) => (
                <tr key={member.id} className="border-t border-[var(--color-card-border)]">
                  <td className="sticky left-0 z-10 bg-[var(--color-card-bg)] px-3 py-1.5 border-r border-[var(--color-card-border)]" style={{ width: 90, minWidth: 90 }}>
                    <span className="text-[var(--color-text-muted)] font-mono truncate block max-w-[70px]">{member.employeeId || '—'}</span>
                  </td>
                  <td className="sticky z-10 bg-[var(--color-card-bg)] px-3 py-1.5 border-r border-[var(--color-card-border)]" style={{ left: 90 }}>
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
                          className="rounded-[5px] h-9 flex items-center justify-center text-[9px] font-semibold leading-none px-0.5 text-center"
                          style={{
                            background: st.bg,
                            border: `1px solid ${st.border}`,
                            // Opaque light fill (allowance) needs fixed dark text for both themes.
                            color: c.status === 'allowance' ? '#1a3d17' : 'var(--color-text-main)',
                          }}
                        >
                          {c.text || ''}
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
  );
}
