import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { setEmployeeTeam, deleteEmployee, getEmployee } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// PATCH: admins only — assign/clear an employee's team. Body: { teamId | null }.
export async function PATCH(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'dev') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { uid } = await ctx.params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const teamId = body?.teamId || null;

  try {
    const result = await setEmployeeTeam(uid, teamId, user.orgId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}

// DELETE: admins only — permanently remove an employee's account. Blocks
// self-deletion, and applies the same target-role ladder as reset-password:
// a SUPER_ADMIN is never deletable here and an ADMIN only by a system admin.
// Without that ceiling any admin/dev could delete the system admin's account.
export async function DELETE(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'dev') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { uid } = await ctx.params;
  if (String(uid) === String(user.id)) {
    return NextResponse.json({ error: 'You can’t delete your own account.' }, { status: 403 });
  }

  let emp;
  try {
    const data = await getEmployee(uid, user.orgId);
    emp = data?.employee || null;
  } catch (err) {
    if (err.status === 404) emp = null;
    else return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
  if (!emp) return NextResponse.json({ error: 'Employee not found in your organization.' }, { status: 404 });
  const targetRole = String(emp.role || '').toUpperCase();
  if (targetRole === 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'A system admin’s account can’t be deleted here.' }, { status: 403 });
  }
  if (targetRole === 'ADMIN' && user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Only a system admin can delete an admin account.' }, { status: 403 });
  }

  try {
    const result = await deleteEmployee(uid, user.orgId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
