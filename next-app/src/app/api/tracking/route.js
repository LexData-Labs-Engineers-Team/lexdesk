import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getTracking, createTracking } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// IT Team (and admins) manage the tracking list.
const allowed = (u) => u.role === 'admin' || u.role === 'superadmin' || u.role === 'dev' || u.role === 'it_team';

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!allowed(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getTracking(user.orgId));
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}

export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!allowed(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const result = await createTracking(body, user.orgId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
