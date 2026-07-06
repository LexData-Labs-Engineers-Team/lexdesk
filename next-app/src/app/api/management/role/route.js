import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { assignManagementRole } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// POST: admins only — assign a management role to an employee.
// Body: { uid, department: 'Engineering'|'Marketing'|'Project'|'IT', role: 'team_leader'|'it' }.
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'dev') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await assignManagementRole(user.orgId, {
      uid: body?.uid,
      department: body?.department,
      role: body?.role,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
