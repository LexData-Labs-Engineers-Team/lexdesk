import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import * as backend from '@/lib/backend';

export const dynamic = 'force-dynamic';

// Admin-gated org-wide reads, now served straight from Firestore (the browser
// can't reach the Admin SDK). Feeds the useAttendData hook.
const RESOURCES = {
  policy: (sp, orgId) => backend.getPolicy(orgId),
  office: (sp, orgId) => backend.getOffice(orgId),
  employees: (sp, orgId) => backend.getEmployees(orgId),
  attendance: (sp, orgId) =>
    backend.getAttendance(
      {
        limit: sp.get('limit') ?? 50,
        from: sp.get('from'),
        to: sp.get('to'),
        userId: sp.get('userId'),
      },
      orgId,
    ),
  leaveRequests: (sp, orgId) => backend.getLeaveRequests({}, orgId),
};

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Org-wide reads: admins and the IT Team role; employees use /api/me/* routes.
  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'dev' && user.role !== 'it_team') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const run = RESOURCES[sp.get('resource')];
  if (!run) return NextResponse.json({ error: 'unknown_resource' }, { status: 400 });

  try {
    return NextResponse.json(await run(sp, user.orgId));
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
