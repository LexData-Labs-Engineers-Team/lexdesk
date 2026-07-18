import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { makeAdminDecide } from '@/lib/webRequestRoutes';
import { decideRecon, deleteRecon } from '@/lib/services/recon';

export const dynamic = 'force-dynamic';

// POST = approve/reject (admin / superadmin / dev, via makeAdminDecide).
export const POST = makeAdminDecide(decideRecon);

// DELETE = permanently remove a reconciliation record. System admin (superadmin)
// ONLY — not org admins, not the recon-approver Dev. Log only: any attendance the
// approval already wrote is left intact.
export async function DELETE(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!user.orgId) return NextResponse.json({ error: 'no_org_on_session' }, { status: 400 });

  const { id } = await ctx.params;
  try {
    return NextResponse.json(await deleteRecon(user.orgId, id));
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
