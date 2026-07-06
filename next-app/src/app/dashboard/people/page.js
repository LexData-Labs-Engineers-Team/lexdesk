'use client';

import { useState } from 'react';
import EmployeesPanel from '@/components/people/EmployeesPanel';
import TeamsPanel from '@/components/people/TeamsPanel';

// Employees and Teams now live in one "People" section as two tabs. Management
// (role assignment) is admin/superadmin only — the IT Team role sees Employees.
const ALL_TABS = [
  { key: 'employees', label: 'Employees', Panel: EmployeesPanel },
  { key: 'teams', label: 'Management', Panel: TeamsPanel, adminOnly: true },
];

function tabsForRole() {
  let role = null;
  if (typeof window !== 'undefined') {
    try { role = JSON.parse(localStorage.getItem('user') || 'null')?.role ?? null; } catch { role = null; }
  }
  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'dev';
  return ALL_TABS.filter((t) => !t.adminOnly || isAdmin);
}

// Read the initial tab from ?tab= so the old per-page routes can deep-link here.
function initialTab(tabs) {
  if (typeof window === 'undefined') return 'employees';
  const t = new URLSearchParams(window.location.search).get('tab');
  return tabs.some((x) => x.key === t) ? t : 'employees';
}

export default function PeoplePage() {
  const [TABS] = useState(tabsForRole);
  const [tab, setTab] = useState(() => initialTab(TABS));
  const active = TABS.find((t) => t.key === tab) || TABS[0];
  const Panel = active.Panel;

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
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

      <Panel />
    </div>
  );
}
