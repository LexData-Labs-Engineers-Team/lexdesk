import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployee, updateEmployee, setEmployeeEmail, setEmployeeRole, writeAuditLog } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// PATCH: Dev-only full profile edit for one employee — basic fields, login
// email, and role in a single call.
//
// Why its own route rather than reusing /api/team/member/[uid]: that one is
// gated by canManageUser (admins, or a lead over their own team) and covers
// basic fields only. This is a different authorization story — one role, a hard
// target ceiling, and it can change identity (email) — so it gets its own
// endpoint instead of widening a shared one.
const isDev = (user) => user.role === 'dev';

// A dev may only edit ordinary staff. ADMIN / SUPER_ADMIN / other DEV accounts
// are off limits: email is a sign-in credential, so allowing an edit here would
// let a dev point a privileged account at an address they control and then take
// it over via password reset.
const EDITABLE_TARGET_ROLES = new Set(['EMPLOYEE', 'IT_TEAM']);

const BASIC_FIELDS = ['name', 'employeeId', 'designation', 'department', 'contactNumber', 'birthDate', 'joiningDate'];

export async function PATCH(request, ctx) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDev(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!user.orgId) return NextResponse.json({ error: 'no_org_on_session' }, { status: 400 });

  const { uid } = await ctx.params;
  if (String(uid) === String(user.id)) {
    return NextResponse.json({ error: 'Use My Profile to edit your own account.' }, { status: 403 });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  let emp;
  try {
    const data = await getEmployee(uid, user.orgId);
    emp = data?.employee || null;
  } catch (err) {
    if (err.status === 404) emp = null;
    else return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
  if (!emp) return NextResponse.json({ error: 'Employee not found in your organization.' }, { status: 404 });

  // Ceiling is checked against the CURRENT stored role, before any write.
  const targetRole = String(emp.role || '').toUpperCase();
  if (!EDITABLE_TARGET_ROLES.has(targetRole)) {
    return NextResponse.json(
      { error: 'Only employee and IT-team accounts can be edited here.' },
      { status: 403 },
    );
  }

  const { name, email, role } = body || {};
  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
  }
  // Guard the ceiling on the way OUT too: promoting to ADMIN/SUPER_ADMIN is not
  // assignable by setEmployeeRole anyway, but refusing here keeps the error clear.
  if (role !== undefined && !['EMPLOYEE', 'IT_TEAM', 'DEV'].includes(String(role).toUpperCase())) {
    return NextResponse.json({ error: 'Role must be EMPLOYEE, IT_TEAM or DEV.' }, { status: 400 });
  }

  const changed = [];
  try {
    // Basic fields first — cheapest and least destructive, so a later failure
    // leaves the smallest surprise.
    const basics = {};
    for (const f of BASIC_FIELDS) if (body?.[f] !== undefined) basics[f] = body[f];
    if (Object.keys(basics).length) {
      await updateEmployee(String(uid), basics, user.orgId);
      changed.push(...Object.keys(basics));
    }

    let emailResult = null;
    if (email !== undefined) {
      emailResult = await setEmployeeEmail(String(uid), email, user.orgId);
      if (emailResult.changed) changed.push('email');
    }

    let roleResult = null;
    if (role !== undefined && String(role).toUpperCase() !== targetRole) {
      roleResult = await setEmployeeRole(String(uid), role, user.orgId);
      changed.push('role');
    }

    if (changed.length) {
      await writeAuditLog(user.orgId, user.id, 'dev_edit_employee', String(uid), {
        targetRole,
        changed,
        // Record the identity move explicitly; never record anything secret.
        ...(emailResult?.changed ? { emailFrom: emailResult.previousEmail, emailTo: emailResult.email } : {}),
        ...(roleResult ? { roleTo: roleResult.role } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      changed,
      email: emailResult?.email ?? emp.email ?? null,
      role: roleResult?.role ?? targetRole,
      // The user must sign in again when their email or role moved.
      sessionsRevoked: !!(emailResult?.changed || roleResult),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message, code: err.code ?? null, upstream: err.body ?? null },
      { status: err.status || 502 },
    );
  }
}
