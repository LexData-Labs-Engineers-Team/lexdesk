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
        cells.push({
          d,
          status: day.status,
          time: day.status === 'late' && ci ? hhmmInOfficeTz(ci.ts) : null,
          tip: day.name || day.subject || day.status,
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
                    {loading ? 'Loading…' : emptyText}
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
  );
}
