import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { updateOffice } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// POST: admins only — update (or create) the org's office in AttendDesk.
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await updateOffice(body, user.orgId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
