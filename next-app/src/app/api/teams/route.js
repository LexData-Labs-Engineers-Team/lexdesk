import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getTeams, createTeam } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// GET: any authenticated user (the team picker / leader views need the list).
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const data = await getTeams(user.orgId);
    return NextResponse.json({ teams: data.teams || [] });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}

// POST: admins or the IT Team role — create a team (IT needs this when adding
// an employee to a department whose team doesn't exist yet).
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user) && user.role !== 'it_team') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const name = (body?.name || '').trim();
  const leaderUid = body?.leaderUid || null;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  try {
    const result = await createTeam({ name, leaderUid }, user.orgId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
