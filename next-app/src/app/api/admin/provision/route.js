import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { createEmployee, getEmployees } from '@/lib/backend';
import { firebaseAdmin, FieldValue } from '@/lib/firebase';
import { Paths } from '@/lib/paths';
import { ORG_ID } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Organization settings (single-org: acts on the pinned ORG_ID).
//  - GET / PATCH (rename company): org admins + system admin. Org admins may
//    view the org and edit its name, but NOT mint admins.
//  - POST (create the org's first ADMIN with a temp password): superadmin only
//    (the env system admin or a seeded SUPER_ADMIN) — keeps an org admin from
//    creating more admins.
const isSuper = (user) => user.role === 'superadmin';
const isAdmin = (user) => user.role === 'admin' || user.role === 'superadmin' || user.role === 'dev';

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { db } = firebaseAdmin();
    const orgSnap = await db.doc(Paths.org(ORG_ID)).get();
    const { employees } = await getEmployees(ORG_ID);
    const admins = (employees || []).filter((e) => String(e.role || '').toUpperCase() === 'ADMIN');
    return NextResponse.json({
      org: { id: ORG_ID, name: orgSnap.exists ? orgSnap.data().name || '' : '' },
      admins,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}

// PATCH: rename the organization (company name only). Org admins + superadmin.
export async function PATCH(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const companyName = String(body?.companyName || '').trim();
  if (!companyName) return NextResponse.json({ error: 'Company name is required' }, { status: 400 });

  try {
    const { db } = firebaseAdmin();
    await db.doc(Paths.org(ORG_ID)).set(
      { name: companyName, source: 'lexdesk', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return NextResponse.json({ ok: true, org: { id: ORG_ID, name: companyName } });
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}

// POST: create the org's first/another ADMIN (temp password). Superadmin only —
// org admins cannot mint admins. companyName is optional here (the name is
// edited via PATCH); if provided it is set/refreshed too.
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSuper(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const companyName = String(body?.companyName || '').trim();
  const adminName = String(body?.adminName || '').trim();
  const adminEmail = String(body?.adminEmail || '').trim();
  if (!adminName || !adminEmail) {
    return NextResponse.json({ error: 'Admin name and admin email are required' }, { status: 400 });
  }

  try {
    const { db } = firebaseAdmin();
    // Optionally set/refresh the company name in the same step.
    if (companyName) {
      await db.doc(Paths.org(ORG_ID)).set(
        { name: companyName, source: 'lexdesk', updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    // Create the org admin (temp password returned to hand over).
    const result = await createEmployee({ email: adminEmail, name: adminName, role: 'ADMIN' }, ORG_ID);
    return NextResponse.json(
      { ok: true, org: companyName || null, admin: result.employee },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
