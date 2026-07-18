import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployee, setUserLoginIps, writeAuditLog } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

// PUT: admins only — set an employee's login IP allowlist (exact IPv4/IPv6 or
// IPv4 CIDR). Empty list ⇒ unrestricted. Employee / IT-team targets only.
// body: { allowlist: string[] }
export async function PUT(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!user.orgId) return NextResponse.json({ error: 'no_org_on_session' }, { status: 400 });

  const { uid } = await ctx.params;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const allowlist = Array.isArray(body?.allowlist) ? body.allowlist : [];

  let emp;
  try {
    const data = await getEmployee(uid, user.orgId);
    emp = data?.employee || null;
  } catch (err) {
    if (err.status === 404) emp = null;
    else {
      return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
    }
  }
  if (!emp) return NextResponse.json({ error: 'Employee not found in your organization.' }, { status: 404 });
  const targetRole = String(emp.role || '').toUpperCase();
  if (targetRole !== 'EMPLOYEE' && targetRole !== 'IT_TEAM') {
    return NextResponse.json({ error: 'Login IP allowlists apply to employee / IT-team accounts only.' }, { status: 403 });
  }

  try {
    const result = await setUserLoginIps(uid, user.orgId, allowlist);
    await writeAuditLog(user.orgId, user.id, 'set_login_ip_allowlist', uid, { count: result.loginIpAllowlist.length });
    return NextResponse.json({ ...result, name: emp.name || null });
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 400 });
  }
}
