import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { makeMineCancel } from '@/lib/mobileRequestRoutes';
import { cancelMyRemote, doneRemote } from '@/lib/services/remote';

export const dynamic = 'force-dynamic';

// DELETE = cancel (discard while working / withdraw while pending).
export const DELETE = makeMineCancel(cancelMyRemote);

// POST = mark the owner's active session Done (server computes hours → pending).
export async function POST(request, ctx) {
  let user;
  try { user = await getMobileUser(request); } catch (e) { return mobileAuthError(e); }
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await doneRemote(user.orgId, user.uid, id));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
