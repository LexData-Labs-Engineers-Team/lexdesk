'use client';

import { useState } from 'react';
import EmployeesPanel from '@/components/people/EmployeesPanel';

// People is now a single compact panel: the Employees views (List / Grid /
// Department) plus a Management view + "Add Management" action, all in one place
// (Management is admin/superadmin only — gated inside EmployeesPanel).
//
// Old per-page routes deep-link here via ?tab=: ?tab=teams opens the Management
// view (admins only), everything else opens the default employee grid.
function initialView() {
  if (typeof window === 'undefined') return 'grid';
  let role = null;
  try { role = JSON.parse(localStorage.getItem('user') || 'null')?.role ?? null; } catch { role = null; }
  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'dev';
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab === 'teams' && isAdmin ? 'management' : 'grid';
}

export default function PeoplePage() {
  const [view] = useState(initialView);
  return <EmployeesPanel initialView={view} />;
}
