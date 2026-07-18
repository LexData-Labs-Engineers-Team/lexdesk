import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployee, resetFace } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// POST: admins only — clear an EMPLOYEE's face enrollment so they can enroll
// again (enrollment is one-time). Org comes from the admin's session, so an
// admin can only act within their own org. Employee targets only, mirroring
// reset-password.
export async function POST(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!user.orgId) return NextResponse.json({ error: 'no_org_on_session' }, { status: 400 });

  const { uid } = await ctx.params;

  let emp;
  try {
    const data = await getEmployee(uid, user.orgId);
    emp = data?.employee || null;
  } catch (err) {
    if (err.status === 404) emp = null;
    else {
      return NextResponse.json(
        { error: err.message, upstream: err.body ?? null },
        { status: err.status || 502 },
      );
    }
  }
  if (!emp) return NextResponse.json({ error: 'Employee not found in your organization.' }, { status: 404 });
  if (!['EMPLOYEE', 'DEV'].includes(String(emp.role || '').toUpperCase())) {
    return NextResponse.json({ error: 'Only employee face enrollments can be reset here.' }, { status: 403 });
  }

  try {
    const result = await resetFace(uid, user.orgId);
    return NextResponse.json({ ...result, name: emp.name || null });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
