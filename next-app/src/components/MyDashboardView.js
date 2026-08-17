'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import MonthNav from '@/components/MonthNav';
import MonthCalendar from '@/components/MonthCalendar';
import CheckInCard from '@/components/CheckInCard';
import { employeeCalendarMonth, bdDateKey, approvedLeaveDays, canonicalDays } from '@/lib/attend';
import { apiFetch } from '@/lib/apiFetch';

function timeFmt(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
  } catch {
    return '—';
  }
}

// notices.created_at is timestamptz, so tsToIso gives a real Z-suffixed ISO
// string — no naive-timestamp fixup needed, just pin the display to office tz.
function dayFmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  } catch {
    return '';
  }
}

// Soft tints for the "At a Glance" stat tiles (kept inside one card, not the
// full KpiCard, to match the reference layout).
const TILE_TINT = {
  purple: { bg: 'rgba(150,150,150,0.15)', fg: 'var(--color-purple)' },
  green: { bg: 'rgba(34,197,94,0.15)', fg: 'var(--color-green)' },
  yellow: { bg: 'rgba(234,179,8,0.15)', fg: 'var(--color-yellow)' },
  blue: { bg: 'rgba(120,120,120,0.15)', fg: 'var(--color-blue)' },
  violet: { bg: 'rgba(167,139,250,0.15)', fg: '#A78BFA' },
};

function StatTile({ icon, label, value, tint = 'purple' }) {
  const t = TILE_TINT[tint] || TILE_TINT.purple;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--color-card-border)] px-4 py-4">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: t.bg, color: t.fg }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--color-text-muted)] truncate">{label}</p>
        <p className="text-2xl font-bold text-[var(--color-text-main)] leading-tight">{value}</p>
      </div>
    </div>
  );
}

// Read-only announcements strip, rendered last on the dashboard. This view is
// shared with /dashboard, so admins see it too — deliberate: they get to see what
// they published without a role read here. Authoring stays on
// /dashboard/noticeboard. The server already sorts pinned-first then newest, so
// the top 3 are the right 3. Always rendered, even when empty: for an employee
// this is the only place on the web that surfaces announcements, and a card that
// disappears is a card nobody discovers.
function NoticesCard({ notices, loading }) {
  const top = (notices || []).slice(0, 3);
  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-main)]">Notice Board</h2>
        <Link
          href="/dashboard/noticeboard?tab=notices"
          className="text-xs font-semibold text-[var(--color-purple)] no-underline hover:underline"
        >
          View all
        </Link>
      </div>
      {loading && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      {!loading && top.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">No announcements right now.</p>
      )}
      {top.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {top.map((n) => (
            <div key={n.id} className="rounded-xl border border-[var(--color-card-border)] px-4 py-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 min-w-0">
                {n.pinned && (
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-[rgba(124,58,237,0.15)] text-[var(--color-purple)] shrink-0">Pinned</span>
                )}
                <h3 className="text-sm font-semibold text-[var(--color-text-main)] truncate">{n.title}</h3>
              </div>
              {/* No whitespace-pre-wrap here: line-clamp switches the element to
                  display:-webkit-box, where preserved newlines would eat both
                  visible lines. Full text is one click away. */}
              {n.body && <p className="text-xs text-[var(--color-text-muted)] line-clamp-2">{n.body}</p>}
              <span className="text-[11px] text-[var(--color-text-muted)] mt-auto pt-1">{dayFmt(n.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Punctuality donut (On-time vs Late) drawn with plain SVG — no chart dep. The
// full ring is the Late color; a green arc overlays the on-time fraction. Center
// shows the on-time % (— when there were no check-ins this month).
const PUNCTUAL_GREEN = '#22C55E';
const PUNCTUAL_YELLOW = '#EAB308';
function PunctualityDonut({ onTime, late }) {
  const total = onTime + late;
  const pct = total > 0 ? Math.round((onTime / total) * 100) : null;
  const size = 188;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = total > 0 ? (onTime / total) * c : 0;
  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        {/* base ring = Late (or neutral when there are no check-ins) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={total > 0 ? PUNCTUAL_YELLOW : 'var(--color-accent-soft)'}
          strokeWidth={stroke}
        />
        {/* on-time arc */}
        {onTime > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={PUNCTUAL_GREEN}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeLinecap={late > 0 ? 'round' : 'butt'}
          />
        )}
      </svg>
      <div className="absolute text-center">
        <p className="text-3xl font-bold text-[var(--color-text-main)] leading-none">{pct === null ? '—' : `${pct}%`}</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">On-time</p>
      </div>
    </div>
  );
}

// Status dot colors — same palette as MonthCalendar / the calendar legend.
const STATUS_DOT = {
  ontime: '#22C55E',
  late: '#EAB308',
  leave: '#EF4444',
  missed: '#BC5A7D',
  holiday: '#5594F8',
  remote: '#B597FF',
};

// Summary panel: day-by-day check-in / check-out times for one week of the
// selected month, with a week filter. Defaults to the week containing today
// (when viewing the current month), so this week's times are visible at once.
function WeekInOutTable({ events, cal, ym }) {
  const canon = useMemo(() => canonicalDays(events), [events]);

  // Weeks of the month as arrays of day-numbers, split on Sundays.
  const weeks = useMemo(() => {
    const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
    const out = [];
    let cur = [];
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(ym.y, ym.m, d).getDay() === 0 && cur.length) { out.push(cur); cur = []; }
      cur.push(d);
    }
    if (cur.length) out.push(cur);
    return out;
  }, [ym]);

  const now = new Date();
  const isThisMonth = now.getFullYear() === ym.y && now.getMonth() === ym.m;
  const defaultWeek = isThisMonth ? Math.max(0, weeks.findIndex((w) => w.includes(now.getDate()))) : 0;
  // The pick is remembered per month (keyed on ym), so switching months falls
  // back to that month's default week without a state-resetting effect.
  const monthKey = `${ym.y}-${ym.m}`;
  const [picked, setPicked] = useState(null); // { key, week }
  const week = picked && picked.key === monthKey ? picked.week : defaultWeek;

  const wi = Math.min(week, weeks.length - 1);
  const mm = String(ym.m + 1).padStart(2, '0');
  const monthShort = new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: 'short' });

  return (
    <div className="flex-1 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">Summary</h3>
        <select
          value={wi}
          onChange={(e) => setPicked({ key: monthKey, week: Number(e.target.value) })}
          className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]"
          aria-label="Select week"
        >
          {weeks.map((w, i) => (
            <option key={i} value={i}>
              Week {i + 1} · {w[0]}–{w[w.length - 1]} {monthShort}
            </option>
          ))}
        </select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
            <th className="py-2 pr-2 font-medium">Date</th>
            <th className="py-2 pr-2 font-medium">Day</th>
            <th className="py-2 pr-2 font-medium">Check in</th>
            <th className="py-2 font-medium">Check out</th>
          </tr>
        </thead>
        <tbody>
          {(weeks[wi] || []).map((d) => {
            const key = `${ym.y}-${mm}-${String(d).padStart(2, '0')}`;
            const slot = canon[key];
            const day = cal.days[d] || {};
            const isToday = isThisMonth && d === now.getDate();
            return (
              <tr key={d} className={`border-t border-[var(--color-card-border)] ${isToday ? 'bg-[var(--color-accent-soft)]' : ''}`}>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ background: STATUS_DOT[day.status] || 'var(--color-card-border)' }}
                      title={day.name || day.subject || day.status || ''}
                    />
                    <span className="text-[var(--color-text-main)] font-medium">{d} {monthShort}</span>
                  </span>
                </td>
                <td className="py-2 pr-2 text-[var(--color-text-muted)]">
                  {new Date(ym.y, ym.m, d).toLocaleDateString(undefined, { weekday: 'short' })}
                </td>
                <td className="py-2 pr-2 text-[var(--color-green)] font-semibold whitespace-nowrap">
                  {slot?.firstCheckIn ? timeFmt(slot.firstCheckIn.ts) : '—'}
                </td>
                <td className="py-2 text-[var(--color-red)] font-semibold whitespace-nowrap">
                  {slot?.lastCheckOut ? timeFmt(slot.lastCheckOut.ts) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Stat-tile icons (kept inline so the card has no extra imports).
const ICONS = {
  leave: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M4 11h16M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  late: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeWidth="2" /><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2 2" /></svg>,
  missed: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="2" /><path strokeWidth="2" strokeLinecap="round" d="M9 10l6 4m0-4l-6 4" /></svg>,
  pending: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeWidth="2" /><path strokeWidth="2" strokeLinecap="round" d="M12 7v5l3 2" /></svg>,
  asset: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>,
  assetApproval: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" /></svg>,
};

export default function MyDashboardPage() {
  const [events, setEvents] = useState([]);
  const [leave, setLeave] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [remote, setRemote] = useState([]);
  const [assets, setAssets] = useState([]);
  const [notices, setNotices] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const [aRes, lRes, hRes, asRes, rRes, nRes] = await Promise.all([
        apiFetch('/api/me/attendance?limit=1000', { headers, cache: 'no-store' }),
        apiFetch('/api/me/leave', { headers, cache: 'no-store' }),
        apiFetch('/api/holidays', { headers, cache: 'no-store' }),
        apiFetch('/api/me/asset', { headers, cache: 'no-store' }),
        apiFetch('/api/me/remote', { headers, cache: 'no-store' }),
        // The path says /api/admin/ but its GET is open to any signed-in user by
        // design — see the route's own comment. This is the read-only feed.
        apiFetch('/api/admin/notices', { headers, cache: 'no-store' }),
      ]);
      const aJson = await aRes.json();
      if (!aRes.ok) throw new Error(aJson.error || `HTTP ${aRes.status}`);
      setEvents(aJson.events || []);
      const lJson = await lRes.json(); if (lRes.ok) setLeave(lJson.requests || []);
      const hJson = await hRes.json(); if (hRes.ok) setHolidays(hJson.holidays || []);
      const asJson = await asRes.json(); if (asRes.ok) setAssets(asJson.requests || []);
      const rJson = await rRes.json(); if (rRes.ok) setRemote(rJson.requests || []);
      const nJson = await nRes.json(); if (nRes.ok) setNotices(nJson.notices || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cal = useMemo(
    () => employeeCalendarMonth(events, leave, holidays, ym.y, ym.m, { remote }),
    [events, leave, holidays, remote, ym],
  );

  // In Time = earliest SUCCESSFUL check-in today; Out Time = latest SUCCESSFUL
  // check-out. Reuses canonicalDays (skips allChecksPassed === false) so failed
  // attempts never set the displayed time — consistent with the rest of the app.
  const today = useMemo(() => {
    const slot = canonicalDays(events)[bdDateKey(new Date())];
    return { inTs: slot?.firstCheckIn?.ts ?? null, outTs: slot?.lastCheckOut?.ts ?? null };
  }, [events]);

  const leaveStats = useMemo(() => {
    const list = leave || [];
    const takenDays = approvedLeaveDays(list, holidays, ym.y);
    const pending = list.filter((r) => r.status === 'pending').length;
    return { takenDays, pending };
  }, [leave, holidays, ym]);

  const assetCount = useMemo(() => (assets || []).filter((a) => a.status === 'approved').length, [assets]);
  const assetPending = useMemo(() => (assets || []).filter((a) => a.status === 'pending').length, [assets]);

  const KPIS = [
    { key: 'leave', label: 'Leave Spent', value: loading ? '…' : leaveStats.takenDays, tint: 'purple', icon: ICONS.leave },
    { key: 'late', label: 'Late', value: loading ? '…' : cal.counts.late, tint: 'yellow', icon: ICONS.late },
    { key: 'missed', label: 'Missed Attendance', value: loading ? '…' : cal.counts.missed, tint: 'violet', icon: ICONS.missed },
    { key: 'pending', label: 'Pending Approval', value: loading ? '…' : leaveStats.pending, tint: 'yellow', icon: ICONS.pending },
    { key: 'asset', label: 'Asset Assigned', value: loading ? '…' : assetCount, tint: 'green', icon: ICONS.asset },
    { key: 'assetApproval', label: 'Assets Approval', value: loading ? '…' : assetPending, tint: 'blue', icon: ICONS.assetApproval },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      {/* Row 1 — At a Glance (wide) and Today's Update share one height. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* At a Glance */}
        <div className="lg:col-span-2 card flex flex-col gap-4">
          <h2 className="text-base font-semibold text-[var(--color-text-main)]">At a Glance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {KPIS.map((k) => (
              <StatTile key={k.key} icon={k.icon} label={k.label} value={k.value} tint={k.tint} />
            ))}
          </div>
        </div>

        {/* Today's Attendance — one title, then check-in, then today's times */}
        <div className="card flex flex-col gap-4">
          <h2 className="text-base font-semibold text-[var(--color-text-main)]">Today&apos;s Attendance</h2>

          {/* Browser check-in — bare + title hidden so this card's title is the
              only one (no duplicate "Verify & Check In" heading). */}
          <CheckInCard onSuccess={load} bare title={null} />

          {/* Today's in/out times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: 'rgba(34,197,94,0.10)' }}>
              <p className="text-xs text-[var(--color-text-muted)]">In Time</p>
              <p className="text-xl font-bold text-[var(--color-green)] mt-1">{today.inTs ? timeFmt(today.inTs) : '—'}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.10)' }}>
              <p className="text-xs text-[var(--color-text-muted)]">Out Time</p>
              <p className="text-xl font-bold text-[var(--color-red)] mt-1">{today.outTs ? timeFmt(today.outTs) : '—'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 — Punctuality (narrow) and the combined Attendance card share one height. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Punctuality — on-time vs late among this month's check-ins */}
        <div className="card flex flex-col">
          <h2 className="text-base font-semibold text-[var(--color-text-main)] mb-4">
            Punctuality · {new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex-1 flex items-center justify-center py-2">
            <PunctualityDonut onTime={cal.counts.ontime} late={cal.counts.late} />
          </div>
          <div className="flex items-center justify-center gap-6 mt-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: PUNCTUAL_GREEN }} />
              <span className="text-[var(--color-text-muted)]">On-time {cal.counts.ontime}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: PUNCTUAL_YELLOW }} />
              <span className="text-[var(--color-text-muted)]">Late {cal.counts.late}</span>
            </span>
          </div>
        </div>

        {/* Attendance — calendar + summary together; month filter in the corner */}
        <div className="lg:col-span-4 card flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--color-text-main)]">Attendance Overview</h2>
            <MonthNav value={ym} onChange={setYm} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="rounded-xl border border-[var(--color-card-border)] p-4">
              <MonthCalendar cal={cal} loading={loading} compact bare />
            </div>
            <div className="rounded-xl border border-[var(--color-card-border)] p-4 flex flex-col">
              <WeekInOutTable events={events} cal={cal} ym={ym} />
            </div>
          </div>
        </div>
      </div>

      {/* Row 3 — Announcements, last card on the dashboard. */}
      <NoticesCard notices={notices} loading={loading} />
    </div>
  );
}
