import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { firebaseAdmin } from '@/lib/firebase';
import { Paths } from '@/lib/paths';
import { signedReadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// GET /api/v1/me — the signed-in mobile user's profile (MeResponse).
export async function GET(request) {
  let user;
  try {
    user = await getMobileUser(request);
  } catch (e) {
    return mobileAuthError(e);
  }
  try {
    const { db } = firebaseAdmin();
    const snap = await db.doc(Paths.user(user.orgId, user.uid)).get();
    if (!snap.exists) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
    const data = snap.data();
    return NextResponse.json({
      id: user.uid,
      email: data.email,
      name: data.name,
      role: data.role,
      employeeId: data.employeeId ?? null,
      designation: data.designation ?? null,
      // Mirror the web: fall back to the employee's team name when the dedicated
      // department field is empty (employee.department || employee.teamName).
      department: data.department || data.teamName || null,
      mustChangePassword: data.mustChangePassword ?? false,
      faceEnrolledAt: data.faceEnrolledAt?.toDate?.()?.toISOString() ?? null,
      photoUrl: await signedReadUrl(data.photoStoragePath),
      photoUpdatedAt: data.photoUpdatedAt?.toDate?.()?.toISOString() ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
