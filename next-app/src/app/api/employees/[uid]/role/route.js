import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { setEmployeeRole } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// PATCH: admins only — assign or clear the IT Team role on an employee.
// Body: { role: 'IT_TEAM' | 'EMPLOYEE' }. The service refuses to touch
// ADMIN/SUPER_ADMIN accounts, so this can't be used to escalate privileges.
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

  try {
    const result = await setEmployeeRole(uid, body?.role, user.orgId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
