import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { createEmployee, getTeams } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// POST: provision a REAL AttendDesk employee account, returning the temporary
// password so the creator can share it. Admins create anyone (any team; only the
// system admin/superadmin may create ADMINs). A team lead may create EMPLOYEEs
// only, auto-joined to a team they lead — never an arbitrary team or role.
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const email = (body?.email || '').trim();
  const name = (body?.name || '').trim();
  const employeeId = (body?.employeeId || '').trim() || null;
  const designation = (body?.designation || '').trim() || null;
  const department = (body?.department || '').trim() || null;
  const contactNumber = (body?.contactNumber || '').trim() || null;
  const birthDate = (body?.birthDate || '').trim() || null;
  const joiningDate = (body?.joiningDate || '').trim() || null;
  if (!email || !name) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 });
  }

  try {
    let role;
    let teamId;
    if (isAdmin(user) || user.role === 'it_team') {
      // Only the system admin (superadmin) may create ADMINs; regular admins and
      // the IT Team role create employees only. (The org admin is provisioned
      // from /dashboard/organization.)
      role = body?.role === 'ADMIN' && user.role === 'superadmin' ? 'ADMIN' : 'EMPLOYEE';
      teamId = body?.teamId || null;
    } else {
      // Team lead path — same leadership check as /api/team/*: the caller must
      // lead ≥1 team, and the new hire is forced into one of those teams.
      if (!user.id) {
        return NextResponse.json({ error: 'no_linked_attenddesk_user' }, { status: 400 });
      }
      const { teams } = await getTeams(user.orgId);
      const ledTeamIds = (teams || [])
        .filter((t) => String(t.leaderUid) === String(user.id))
        .map((t) => t.id);
      if (ledTeamIds.length === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      role = 'EMPLOYEE';
      const requested = body?.teamId || null;
      if (requested && ledTeamIds.includes(requested)) teamId = requested;
      else if (ledTeamIds.length === 1) teamId = ledTeamIds[0];
      else return NextResponse.json({ error: 'Pick one of the teams you lead' }, { status: 400 });
    }

    const result = await createEmployee(
      { email, name, role, teamId, employeeId, designation, department, contactNumber, birthDate, joiningDate },
      user.orgId,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
