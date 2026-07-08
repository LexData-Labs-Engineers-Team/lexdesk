'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import MonthNav from '@/components/MonthNav';
import { useAttendData } from '@/lib/useAttendData';
import { apiFetch } from '@/lib/apiFetch';
import { todaySummary, onLeaveTodayCount, onlyEmployees, perEmployeeStats } from '@/lib/attend';

// One summary card per approval type, linking through to its tab on the
// Approvals page.
const APPROVAL_CARDS = [
  { key: 'leave', label: 'Leave' },
  { key: 'asset', label: 'Assets' },
  { key: 'remote', label: 'Remote' },
  { key: 'recon', label: 'Reconciliation' },
];
const apprCounts = (list = []) => ({
  total: list.length,
  approved: list.filter((r) => r.status === 'approved').length,
  pending: list.filter((r) => r.status === 'pending').length,
});

// Horizontal bar used by the attendance-insight cards (moved here from the
// former standalone Analytics page).
function HBar({ value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function DashboardPage() {
  // Today's KPIs only need the current month's events (today is in it); the
  // MonthNav below drives the leave panel, not attendance.
  const thisMonth = useMemo(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; }, []);
  const { employees, events, leave, loading, error, refresh } = useAttendData(
    ['employees', 'attendance', 'leaveRequests'],
    { month: thisMonth },
  );

  const today = useMemo(() => todaySummary(events), [events]);
  const onLeave = useMemo(() => onLeaveTodayCount(leave), [leave]);

  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  // Org-wide approval workload across all four request types.
  const [approvals, setApprovals] = useState(null);
  const [apprLoading, setApprLoading] = useState(true);
  const loadApprovals = useCallback(async () => {
    setApprLoading(true);
    try {
      const token = localStorage.getItem('token');
      const results = await Promise.all(
        APPROVAL_CARDS.map(async ({ key }) => {
          const res = await apiFetch(`/api/admin/${key}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
          const json = await res.json().catch(() => ({}));
          return [key, res.ok ? json.requests || [] : []];
        }),
      );
      setApprovals(Object.fromEntries(results));
    } catch {
      setApprovals({});
    } finally {
      setApprLoading(false);
    }
  }, []);
  useEffect(() => { loadApprovals(); }, [loadApprovals]);

  // Attendance insights for the selected month (folded in from Analytics).
  const monthEvents = useMemo(
    () =>
      (events || []).filter((e) => {
        if (!e.timestamp) return false;
        const d = new Date(e.timestamp);
        return d.getFullYear() === ym.y && d.getMonth() === ym.m;
      }),
    [events, ym],
  );
  const stats = useMemo(() => perEmployeeStats(monthEvents), [monthEvents]);
  const nameById = useMemo(() => Object.fromEntries((employees || []).map((e) => [e.id, e.name || e.email])), [employees]);
  const statRows = useMemo(() => Object.entries(stats).map(([uid, s]) => ({ id: uid, name: nameById[uid] || uid, ...s })), [stats, nameById]);
  const topLate = useMemo(() => [...statRows].filter((r) => r.lateDays > 0).sort((a, b) => b.lateDays - a.lateDays).slice(0, 5), [statRows]);
  const topActive = useMemo(() => [...statRows].sort((a, b) => b.presentDays - a.presentDays).slice(0, 5), [statRows]);
  const maxLate = Math.max(1, ...topLate.map((e) => e.lateDays));
  const maxActive = Math.max(1, ...topActive.map((e) => e.presentDays));

  const kpis = [
    { label: 'Employees', value: onlyEmployees(employees).length, color: 'purple' },
    { label: 'Checked in today', value: today.checkedIn, color: 'green' },
    { label: 'Late today', value: today.late, color: 'yellow' },
    { label: 'On leave today', value: onLeave, color: 'blue' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        subtitle="Live overview from AttendDesk"
        actions={
          <div className="flex items-center gap-2">
            <MonthNav value={ym} onChange={setYm} />
            <button onClick={() => { refresh(); loadApprovals(); }} className="btn-outline py-2 px-4 text-sm">Refresh</button>
          </div>
        }
      />

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={loading ? '…' : k.value} color={k.color} />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {APPROVAL_CARDS.map((c) => {
          const k = apprCounts(approvals?.[c.key]);
          return (
            <Link
              key={c.key}
              href={`/dashboard/approvals?tab=${c.key}`}
              className="card no-underline hover:border-[var(--color-purple)] transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-[var(--color-text-main)]">{c.label}</h2>
                {k.pending > 0 && !apprLoading && (
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-[rgba(234,179,8,0.15)] text-[var(--color-yellow)]">{k.pending} pending</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center"><p className="text-[11px] text-[var(--color-text-muted)]">Total</p><p className="text-xl font-bold text-[var(--color-text-main)] mt-0.5">{apprLoading ? '…' : k.total}</p></div>
                <div className="text-center"><p className="text-[11px] text-[var(--color-text-muted)]">Approved</p><p className="text-xl font-bold text-[var(--color-green)] mt-0.5">{apprLoading ? '…' : k.approved}</p></div>
                <div className="text-center"><p className="text-[11px] text-[var(--color-text-muted)]">Pending</p><p className="text-xl font-bold text-[var(--color-yellow)] mt-0.5">{apprLoading ? '…' : k.pending}</p></div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold text-lg mb-4">Top 5 — Most Late</h3>
          <div className="flex flex-col gap-3">
            {topLate.length === 0 && <div className="text-[var(--color-text-muted)] text-sm">No late check-ins this month</div>}
            {topLate.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between text-sm mb-1"><span className="text-[var(--color-text-main)] truncate">{e.name}</span><span className="text-[var(--color-yellow)] font-semibold">{e.lateDays}</span></div>
                <HBar value={e.lateDays} max={maxLate} color="var(--color-yellow)" />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-lg mb-4">Top 5 — Most Active</h3>
          <div className="flex flex-col gap-3">
            {topActive.length === 0 && <div className="text-[var(--color-text-muted)] text-sm">No check-ins this month</div>}
            {topActive.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between text-sm mb-1"><span className="text-[var(--color-text-main)] truncate">{e.name}</span><span className="text-[var(--color-green)] font-semibold">{e.presentDays}</span></div>
                <HBar value={e.presentDays} max={maxActive} color="var(--color-green)" />
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
