'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import LeaveApprovalsPanel from '@/components/approvals/LeaveApprovalsPanel';
import AssetApprovalsPanel from '@/components/approvals/AssetApprovalsPanel';
import RemoteApprovalsPanel from '@/components/approvals/RemoteApprovalsPanel';
import ReconApprovalsPanel from '@/components/approvals/ReconApprovalsPanel';

// Each approval type lives in its own tab under the single "Approvals" section.
// Remote/Reconciliation are admin-only; the IT Team role sees Leave + Assets
// (read-only — see readOnly below).
const ALL_TABS = [
  { key: 'leave', label: 'Leave Approval', Panel: LeaveApprovalsPanel },
  { key: 'asset', label: 'Assets Approval', Panel: AssetApprovalsPanel },
  { key: 'remote', label: 'Remote Approval', Panel: RemoteApprovalsPanel, adminOnly: true },
  { key: 'recon', label: 'Reconciliation Approval', Panel: ReconApprovalsPanel, adminOnly: true },
];

function viewerRole() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('user') || 'null')?.role ?? null; } catch { return null; }
}

function tabsFor(role) {
  // Dev is a recon-only approver on web (not leave/asset/remote).
  if (role === 'dev') return ALL_TABS.filter((t) => t.key === 'recon');
  const admin = role === 'admin' || role === 'superadmin';
  return ALL_TABS.filter((t) => !t.adminOnly || admin);
}

// Read the initial tab from ?tab= so old per-type routes can deep-link here.
function initialTab(tabs) {
  if (typeof window === 'undefined') return 'leave';
  const t = new URLSearchParams(window.location.search).get('tab');
  return tabs.some((x) => x.key === t) ? t : 'leave';
}

export default function ApprovalsPage() {
  const [role] = useState(viewerRole);
  const readOnly = role === 'it_team'; // IT can see status but not decide.
  const [TABS] = useState(() => tabsFor(role));
  const [tab, setTab] = useState(() => initialTab(TABS));
  const active = TABS.find((t) => t.key === tab) || TABS[0];
  const Panel = active.Panel;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        subtitle={readOnly ? 'Track leave and asset requests and their status' : 'Review and decide all employee requests in one place'}
      />

      <div className="card flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              tab === t.key
                ? 'bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)] border border-[var(--color-purple)]'
                : 'btn-outline'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Panel readOnly={readOnly} />
    </div>
  );
}
