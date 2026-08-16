import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployee, diagnoseAuthLink, repairAuthAccount, writeAuditLog } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// Reconcile an employee's Neon profile with Firebase Auth.
//
//   GET  — non-mutating diagnosis (drives the UI affordance)
//   POST — rebuild a missing sign-in account AT THE SAME uid, so attendance
//          history, team membership and face enrollment stay attached.
//
// Restricted to Dev. Superadmin is included as a deliberate break-glass path:
// the env system admin is the one identity that still works when Firebase state
// is broken, and a Dev-only gate is circular if the sole Dev's own account is
// the orphaned one.
const canRepair = (user) => user.role === 'dev' || user.role === 'superadmin';

// Target-role ceiling — the security that actually matters here. Web login reads
// a user's role from the Neon row keyed by Firebase uid, so creating an account
// at a chosen uid mints credentials carrying that row's role and this endpoint
// hands back the password. Privileged rows are therefore never repairable, for
// any caller. Fails closed on an unknown or missing role.
function roleBlockReason(targetRole, callerRole) {
  if (targetRole === 'SUPER_ADMIN' || targetRole === 'ADMIN') {
    return 'An admin account’s sign-in can’t be rebuilt here — recreate it through provisioning.';
  }
  if (targetRole === 'DEV' && callerRole !== 'superadmin') {
    return 'Only a system admin can rebuild a Dev account’s sign-in.';
  }
  if (targetRole !== 'EMPLOYEE' && targetRole !== 'IT_TEAM' && targetRole !== 'DEV') {
    return 'This account’s sign-in can’t be rebuilt here.';
  }
  return null;
}

// Shared preamble: authenticate, gate, load the target, apply the ceiling.
// Returns either { error: NextResponse } or { user, uid, emp, targetRole }.
async function guard(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!canRepair(user)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  if (!user.orgId) return { error: NextResponse.json({ error: 'no_org_on_session' }, { status: 400 }) };

  const { uid } = await ctx.params;
  if (String(uid) === String(user.id)) {
    return { error: NextResponse.json({ error: 'You can’t repair your own account.' }, { status: 403 }) };
  }

  let emp;
  try {
    const data = await getEmployee(uid, user.orgId);
    emp = data?.employee || null;
  } catch (err) {
    if (err.status === 404) emp = null;
    else return { error: NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 }) };
  }
  if (!emp) return { error: NextResponse.json({ error: 'Employee not found in your organization.' }, { status: 404 }) };

  return { user, uid, emp, targetRole: String(emp.role || '').toUpperCase() };
}

export async function GET(request, ctx) {
  const g = await guard(request, ctx);
  if (g.error) return g.error;

  try {
    const result = await diagnoseAuthLink(g.uid, g.user.orgId);
    const blocked = roleBlockReason(g.targetRole, g.user.role);
    return NextResponse.json({ ...result, canRepair: result.canRepair && !blocked, blockedReason: blocked });
  } catch (err) {
    return NextResponse.json({ error: err.message, code: err.code ?? null, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}

export async function POST(request, ctx) {
  const g = await guard(request, ctx);
  if (g.error) return g.error;
  const { user, uid, emp, targetRole } = g;

  // The request body is deliberately never read: uid comes from the URL, and
  // email/name/role are read back from the Neon row inside repairAuthAccount. A
  // client-supplied email would let a caller bind an inbox they control to a
  // privileged uid — a permanent re-entry lever via password reset.
  const blocked = roleBlockReason(targetRole, user.role);
  if (blocked) {
    // Log the refusal: an attempt against a privileged row is the highest-value
    // detection signal this endpoint produces, and only logging successes would
    // discard it.
    await writeAuditLog(user.orgId, user.id, 'repair_auth_blocked', uid, {
      callerRole: user.role, targetRole, reason: blocked,
    });
    return NextResponse.json({ error: blocked }, { status: 403 });
  }

  try {
    const result = await repairAuthAccount(uid, user.orgId);
    // Never log the temporary password.
    await writeAuditLog(user.orgId, user.id, 'repair_auth_account', uid, {
      callerRole: user.role, targetRole, action: result.action, targetEmail: result.email,
    });
    return NextResponse.json({ ...result, name: result.name ?? emp.name ?? null });
  } catch (err) {
    await writeAuditLog(user.orgId, user.id, 'repair_auth_failed', uid, {
      callerRole: user.role, targetRole, code: err.code ?? null, reason: err.message,
    });
    return NextResponse.json(
      { error: err.message, code: err.code ?? null, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
