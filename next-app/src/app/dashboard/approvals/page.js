'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import AllApprovalsPanel from '@/components/approvals/AllApprovalsPanel';

function viewerRole() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('user') || 'null')?.role ?? null; } catch { return null; }
}

// One combined approvals list (leave / asset / remote / reconciliation) with a
// Type badge per row — no per-type tabs. Which types appear is role-scoped
// inside AllApprovalsPanel (IT Team read-only; dev sees reconciliation only).
export default function ApprovalsPage() {
  const [role] = useState(viewerRole);
  const readOnly = role === 'it_team';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        subtitle={readOnly ? 'Track leave and asset requests and their status' : 'Review and decide all employee requests in one place'}
      />
      <AllApprovalsPanel />
    </div>
  );
}
