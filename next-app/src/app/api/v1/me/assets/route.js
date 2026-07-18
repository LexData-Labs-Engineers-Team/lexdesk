import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { getAssetRequests, createAssetRequest } from '@/lib/services/assets';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v1/me/assets — the caller's own asset requests.
export async function GET(request) {
  let user;
  try { user = await getMobileUser(request); } catch (e) { return mobileAuthError(e); }
  try { return NextResponse.json(await getAssetRequests({ userId: user.uid }, user.orgId)); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 500 }); }
}

// POST /api/v1/me/assets — create a requisition. Resolves team-lead routing
// (requiresLead) like the web /api/me/asset route.
export async function POST(request) {
  let user;
  try { user = await getMobileUser(request); } catch (e) { return mobileAuthError(e); }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (!body?.assetName || !body?.fromDay || !body?.toDay) {
    return NextResponse.json({ error: 'assetName, fromDay and toDay are required' }, { status: 400 });
  }
  try {
    let requiresLead = false;
    const uRows = await sql`SELECT team_id FROM users WHERE firebase_uid = ${user.uid} AND org_id = ${user.orgId} LIMIT 1`;
    const teamId = uRows[0]?.team_id || null;
    if (teamId) {
      const tRows = await sql`SELECT leader_uid FROM teams WHERE id = ${teamId} AND org_id = ${user.orgId} LIMIT 1`;
      const leaderUid = tRows[0]?.leader_uid || null;
      if (leaderUid && String(leaderUid) !== String(user.uid)) requiresLead = true;
    }
    const result = await createAssetRequest({ ...body, userId: user.uid, requiresLead }, user.orgId);
    return NextResponse.json(result, { status: 201 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 500 }); }
}
