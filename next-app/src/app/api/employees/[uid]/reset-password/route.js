import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployee, resetUserPassword } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// POST: reset another user's password to a temp one (returned for display).
// Admins may reset EMPLOYEES; a superadmin (system admin) may also reset ADMINS.
// Nobody resets a SUPER_ADMIN here, nor their own account. Org-scoped via session.
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
  if (!emp) return NextResponse.json({ error: 'User not found in your organization.' }, { status: 404 });
  if (String(uid) === String(user.id)) {
    return NextResponse.json({ error: 'Use “Change password” to reset your own account.' }, { status: 403 });
  }
  const targetRole = String(emp.role || '').toUpperCase();
  const callerSuper = user.role === 'superadmin';
  if (targetRole === 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'A system admin’s password can’t be reset here.' }, { status: 403 });
  }
  if (targetRole === 'ADMIN' && !callerSuper) {
    return NextResponse.json({ error: 'Only a system admin can reset an admin’s password.' }, { status: 403 });
  }
  if (targetRole !== 'EMPLOYEE' && targetRole !== 'ADMIN' && targetRole !== 'DEV') {
    return NextResponse.json({ error: 'This account’s password can’t be reset here.' }, { status: 403 });
  }
  if (!emp.email) return NextResponse.json({ error: 'This user has no email on file.' }, { status: 400 });

  try {
    const result = await resetUserPassword(emp.email, user.orgId);
    return NextResponse.json({ ...result, name: emp.name || null });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
