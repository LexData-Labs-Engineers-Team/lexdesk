import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { deleteNotice } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function DELETE(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'dev') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await deleteNotice(id, user.orgId));
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
