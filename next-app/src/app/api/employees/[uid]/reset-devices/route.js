import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployee, resetUserDevices, writeAuditLog } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// POST: admins only — clear an employee's registered login devices so they can
// sign in on a new one (the login device cap is 2). Employee / IT-team targets
// only, mirroring reset-face/reset-password. Org comes from the admin's session.
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
      return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
    }
  }
  if (!emp) return NextResponse.json({ error: 'Employee not found in your organization.' }, { status: 404 });
  const targetRole = String(emp.role || '').toUpperCase();
  if (targetRole !== 'EMPLOYEE' && targetRole !== 'IT_TEAM') {
    return NextResponse.json({ error: 'Only employee / IT-team device lists can be reset here.' }, { status: 403 });
  }

  try {
    const result = await resetUserDevices(uid, user.orgId);
    await writeAuditLog(user.orgId, user.id, 'reset_login_devices', uid, { cleared: result.cleared });
    return NextResponse.json({ ...result, name: emp.name || null });
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
