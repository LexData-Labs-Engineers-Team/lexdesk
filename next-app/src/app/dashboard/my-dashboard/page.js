'use client';

import MyDashboardView from '@/components/MyDashboardView';

// Employee (and team-leader) landing dashboard. The implementation lives in
// MyDashboardView so the superadmin/admin dashboard (/dashboard) can render the
// exact same view without duplicating it.
export default function MyDashboardPage() {
  return <MyDashboardView />;
}
