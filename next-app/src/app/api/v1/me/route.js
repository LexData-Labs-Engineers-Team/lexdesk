import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { sql } from '@/lib/db';
import { tsToIso } from '@/lib/rows';
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
    const rows = await sql`SELECT * FROM users WHERE firebase_uid=${user.uid} AND org_id=${user.orgId}`;
    const data = rows[0];
    if (!data) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
    return NextResponse.json({
      id: user.uid,
      email: data.email,
      name: data.name,
      role: data.role,
      employeeId: data.employee_id ?? null,
      designation: data.designation ?? null,
      // Mirror the web: fall back to the employee's team name when the dedicated
      // department field is empty (employee.department || employee.teamName).
      department: data.department || data.team_name || null,
      mustChangePassword: data.must_change_password ?? false,
      faceEnrolledAt: tsToIso(data.face_enrolled_at),
      photoUrl: await signedReadUrl(data.photo_storage_path),
      photoUpdatedAt: tsToIso(data.photo_updated_at),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
