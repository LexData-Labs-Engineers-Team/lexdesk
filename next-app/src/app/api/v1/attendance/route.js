import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { getEmployees } from '@/lib/services/users';
import { listAttendance } from '@/lib/services/attendance';
import { dhakaDay, lastSevenDays, memberSummary, indexEventsByUid } from '@/lib/attendSummary';

export const dynamic = 'force-dynamic';

// GET /api/v1/attendance — roster of EVERY employee's today in/out + last-7-day
// on-time/late/absent. Visible to any signed-in employee (the "View Attendance"
// board). Like /api/v1/directory, this is org-wide and not manager-gated.
export async function GET(request) {
  let user;
  try { user = await getMobileUser(request); } catch (e) { return mobileAuthError(e); }
  try {
    const { employees } = await getEmployees(user.orgId);
    // The attendance board lists employees only — exclude org admins/super-admins
    // (they don't punch in and shouldn't appear in the roster).
    const staff = employees.filter((e) => {
      const r = String(e.role ?? '').toUpperCase();
      return r !== 'ADMIN' && r !== 'SUPER_ADMIN' && r !== 'SUPERADMIN';
    });

    // Bound the fetch to the trailing window so the 1000-event cap reflects the
    // 7-day window instead of silently truncating older days for a busy org
    // (over-fetch by a day to safely cover the earliest Dhaka day-start).
    const from = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { events } = await listAttendance(user.orgId, { from, limit: 1000 });

    const today = dhakaDay(new Date().toISOString());
    const last7 = lastSevenDays(Date.now());
    const byUid = indexEventsByUid(events);

    const members = staff.map((p) => ({
      uid: p.id,
      name: p.name || p.email || '',
      email: p.email || '',
      ...memberSummary(byUid[String(p.id)] || [], last7, today),
    }));

    return NextResponse.json({ scope: 'all', members });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 500 }); }
}
