import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// DELETE /api/v1/me/data — clear the caller's face enrollment (GDPR-style).
export async function DELETE(request) {
  let user;
  try {
    user = await getMobileUser(request);
  } catch (e) {
    return mobileAuthError(e);
  }
  try {
    await sql`
      UPDATE users
      SET face_embedding_b64 = NULL,
          face_embedding_model = NULL,
          face_enrolled_at = NULL
      WHERE firebase_uid = ${user.uid} AND org_id = ${user.orgId}
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
