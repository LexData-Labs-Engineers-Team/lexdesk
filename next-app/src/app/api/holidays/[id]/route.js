import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { deleteHoliday } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// DELETE: admins only — remove a custom org holiday by id.
export async function DELETE(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'dev') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  try {
    const result = await deleteHoliday(id, user.orgId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
