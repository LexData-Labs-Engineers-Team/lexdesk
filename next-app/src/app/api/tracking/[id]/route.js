import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { deleteTracking } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const allowed = (u) => u.role === 'admin' || u.role === 'superadmin' || u.role === 'dev' || u.role === 'it_team';

// DELETE: remove a tracking item.
export async function DELETE(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!allowed(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const result = await deleteTracking(id, user.orgId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
