import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getTeams, getEmployees, getAttendance, addManualAttendance, signedReadUrls } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// POST: manually add an attendance event for a team member. A team lead may
// only add for members of a team they lead; an admin may add for anyone.
// body: { uid, type: 'CHECK_IN'|'CHECK_OUT', at: ISO-8601, note? }
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.id) return NextResponse.json({ error: 'no_linked_attenddesk_user' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { uid, type, at, note } = body || {};
  if (!uid || !at) return NextResponse.json({ error: 'uid and at are required' }, { status: 400 });
  if (type !== 'CHECK_IN' && type !== 'CHECK_OUT') {
    return NextResponse.json({ error: 'type must be CHECK_IN or CHECK_OUT' }, { status: 400 });
  }

  try {
    const isAdmin = user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';
    if (!isAdmin) {
      const teamsData = await getTeams(user.orgId);
      const myTeamIds = new Set(
        (teamsData.teams || []).filter((t) => String(t.leaderUid) === String(user.id)).map((t) => t.id),
      );
      if (myTeamIds.size === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const empData = await getEmployees(user.orgId);
      const target = (empData.employees || []).find((e) => String(e.id) === String(uid));
      if (!target || !target.teamId || !myTeamIds.has(target.teamId)) {
        return NextResponse.json({ error: 'Forbidden — not a member of a team you lead' }, { status: 403 });
      }
    }
    const result = await addManualAttendance(user.orgId, { uid, type, atISO: at, note }, user.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}

// GET: attendance events for members of the team(s) the caller LEADS, plus
// the member roster so the page needs no second call. Leadership is resolved
// server-side from the verified token (same pattern as /api/team/leave).
//
// Known limits, both shared with the rest of the app: the upstream fetch is an
// org-wide window capped at 1000 events (a very busy org could clip a heavy
// month), and membership is current-state (someone who left the team
// mid-month disappears along with their early-month events).
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.id) return NextResponse.json({ error: 'no_linked_attenddesk_user' }, { status: 400 });

  const sp = new URL(request.url).searchParams;
  const from = sp.get('from') || undefined;
  const to = sp.get('to') || undefined;
  if (from && Number.isNaN(Date.parse(from))) {
    return NextResponse.json({ error: 'invalid_from' }, { status: 400 });
  }
  if (to && Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ error: 'invalid_to' }, { status: 400 });
  }
  const limit = Math.min(Math.max(parseInt(sp.get('limit'), 10) || 1000, 1), 1000);

  try {
    // These three reads are independent — run them concurrently instead of
    // stacking their round-trips. Photos are NOT signed here (signPhotos:false);
    // we sign only the lead's team members below, not the whole org.
    const [teamsData, empData, data] = await Promise.all([
      getTeams(user.orgId),
      getEmployees(user.orgId, { signPhotos: false }),
      getAttendance({ limit, from, to }, user.orgId),
    ]);

    const myTeams = (teamsData.teams || []).filter((t) => String(t.leaderUid) === String(user.id));
    if (myTeams.length === 0) {
      return NextResponse.json({ isLeader: false, events: [], members: [], teams: [] });
    }
    const myTeamIds = new Set(myTeams.map((t) => t.id));
    const teamNameById = new Map(myTeams.map((t) => [t.id, t.name || '']));

    const teamEmployees = (empData.employees || []).filter((e) => e.teamId && myTeamIds.has(e.teamId));
    // Sign photo URLs for just this team's members (small N), not the whole org.
    const photoUrls = await signedReadUrls(teamEmployees.map((e) => e.photoStoragePath));
    const members = teamEmployees.map((e, i) => ({
      id: String(e.id),
      name: e.name || '',
      email: e.email || '',
      teamId: e.teamId,
      teamName: teamNameById.get(e.teamId) || '',
      employeeId: e.employeeId || null,
      designation: e.designation || null,
      department: e.department || null,
      contactNumber: e.contactNumber || null,
      joiningDate: e.joiningDate || e.createdAt || null,
      birthDate: e.birthDate || null,
      photoUrl: photoUrls[i] || null,
    }));
    const memberUids = new Set(members.map((m) => m.id));

    const events = (data.events || []).filter((e) => memberUids.has(String(e.user?.id)));
    // The led teams (incl. empty ones) so the page can offer a team picker when
    // adding a member without a second request.
    const teams = myTeams.map((t) => ({ id: t.id, name: t.name || '' }));
    return NextResponse.json({ isLeader: true, events, members, teams });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
