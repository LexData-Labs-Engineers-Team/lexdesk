import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getHolidays, createHoliday } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// GET: any authenticated user (employees need holidays to render their calendar).
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const data = await getHolidays(user.orgId);
    return NextResponse.json({ holidays: data.holidays || [] });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}

// POST: admins only — create a custom org holiday.
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
  const name = (body?.name || '').trim();
  const fromDay = body?.fromDay;
  const toDay = body?.toDay || fromDay;
  if (!fromDay || !name) {
    return NextResponse.json({ error: 'fromDay and name are required' }, { status: 400 });
  }
  if (fromDay > toDay) {
    return NextResponse.json({ error: 'fromDay must be on or before toDay' }, { status: 400 });
  }

  try {
    const result = await createHoliday({ fromDay, toDay, name }, user.orgId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
