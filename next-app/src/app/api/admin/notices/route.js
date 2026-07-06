import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { listNotices, createNotice } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// Any signed-in user can read; only admins author.
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await listNotices(user.orgId));
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}

export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'dev') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  try {
    return NextResponse.json(await createNotice(body, user.orgId, user.id), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
