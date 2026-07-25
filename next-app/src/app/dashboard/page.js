'use client';

import { useState } from 'react';
import MyDashboardView from '@/components/MyDashboardView';
import OrgAttendanceCalendar from '@/components/attendance/OrgAttendanceCalendar';
import OrgTeamLeaveSummary from '@/components/attendance/OrgTeamLeaveSummary';

// Superadmin / admin landing dashboard. Tabs: "Overview" mirrors the employee /
// team-leader dashboard (MyDashboardView — same component, so the two stay in
// sync), "Team Attendance" is the org-wide member × day calendar, and "Team
// Leave" is the org-wide yearly per-employee leave summary.
export default function DashboardPage() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex p-1 rounded-xl bg-[var(--color-card-bg)] border border-[var(--color-card-border)] gap-1 self-start">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'attendance', label: 'Team Attendance' },
          { key: 'leave', label: 'Team Leave' },
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
      {tab === 'overview' ? <MyDashboardView /> : tab === 'attendance' ? <OrgAttendanceCalendar /> : <OrgTeamLeaveSummary />}
    </div>
  );
}
