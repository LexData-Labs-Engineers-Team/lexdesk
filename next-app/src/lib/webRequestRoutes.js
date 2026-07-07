import { NextResponse } from 'next/server';
import { getUserFromRequest } from './auth';
import { listLedTeamMemberUids, canManageUser } from './services/teams';

// JWT (web) analogue of mobileRequestRoutes.js. Employee handlers force userId
// from the verified token; admin handlers require admin/superadmin; team
// handlers scope a lead to their own members. Mirrors api/me/leave +
// api/admin/leave/[id] + api/team/leave patterns.

const unauth = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const noUser = () => NextResponse.json({ error: 'no_linked_attenddesk_user' }, { status: 400 });
const fail = (e) => NextResponse.json({ error: e.message, upstream: e.body ?? null }, { status: e.status || 502 });
// admin/superadmin everywhere; dev is additionally allowed here because these
// factories (makeAdminList/makeAdminDecide) back ONLY the recon approval routes —
// so this grants Dev recon approvals without touching leave/asset/remote.
const isAdmin = (role) => role === 'admin' || role === 'superadmin' || role === 'dev';

export function makeMineGet(listMineFn) {
  return async (request) => {
    const user = getUserFromRequest(request);
    if (!user) return unauth();
    if (!user.id) return noUser();
    try { return NextResponse.json(await listMineFn(user.orgId, String(user.id))); } catch (e) { return fail(e); }
  };
}

export function makeMinePost(submitFn, required = []) {
  return async (request) => {
    const user = getUserFromRequest(request);
    if (!user) return unauth();
    if (!user.id) return noUser();
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    for (const f of required) {
      const v = body?.[f];
      if (v === undefined || v === null || v === '') return NextResponse.json({ error: `${f} is required` }, { status: 400 });
    }
    try { return NextResponse.json(await submitFn({ ...body, userId: String(user.id) }, user.orgId), { status: 201 }); } catch (e) { return fail(e); }
  };
}

export function makeMineCancel(cancelFn) {
  return async (request, ctx) => {
    const user = getUserFromRequest(request);
    if (!user) return unauth();
    if (!user.id) return noUser();
    const { id } = await ctx.params;
    try { return NextResponse.json(await cancelFn(user.orgId, String(user.id), id)); } catch (e) { return fail(e); }
  };
}

export function makeAdminList(listFn) {
  return async (request) => {
    const user = getUserFromRequest(request);
    if (!user) return unauth();
    if (!isAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const status = new URL(request.url).searchParams.get('status') || undefined;
    try { return NextResponse.json(await listFn(status ? { status } : {}, user.orgId)); } catch (e) { return fail(e); }
  };
}

export function makeAdminDecide(decideFn) {
  return async (request, ctx) => {
    const user = getUserFromRequest(request);
    if (!user) return unauth();
    if (!isAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id } = await ctx.params;
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const { decision, note } = body || {};
    if (decision !== 'approved' && decision !== 'rejected') return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
    try { return NextResponse.json(await decideFn(id, decision, note || undefined, user.orgId, String(user.id))); } catch (e) { return fail(e); }
  };
}

export function makeTeamList(listFn) {
  return async (request) => {
    const user = getUserFromRequest(request);
    if (!user) return unauth();
    if (!user.id) return noUser();
    const status = new URL(request.url).searchParams.get('status') || undefined;
    try {
      const { isLeader, memberUids } = await listLedTeamMemberUids(user.orgId, String(user.id));
      if (!isLeader) return NextResponse.json({ isLeader: false, requests: [] });
      const { requests } = await listFn(status ? { status } : {}, user.orgId);
      return NextResponse.json({ isLeader: true, requests: requests.filter((r) => memberUids.has(String(r.uid))) });
    } catch (e) { return fail(e); }
  };
}

export function makeTeamDecide(getOneFn, decideFn) {
  return async (request, ctx) => {
    const user = getUserFromRequest(request);
    if (!user) return unauth();
    if (!user.id) return noUser();
    const { id } = await ctx.params;
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const { decision, note } = body || {};
    if (decision !== 'approved' && decision !== 'rejected') return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 });
    try {
      const row = await getOneFn(user.orgId, id);
      if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      const ok = await canManageUser(user.orgId, String(user.id), user.role, row.uid);
      if (!ok) return NextResponse.json({ error: 'Forbidden — not your team member' }, { status: 403 });
      return NextResponse.json(await decideFn(id, decision, note || undefined, user.orgId, String(user.id)));
    } catch (e) { return fail(e); }
  };
}
