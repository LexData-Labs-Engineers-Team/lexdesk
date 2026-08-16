import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { uploadPhoto } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// Upload the signed-in user's own profile photo to Firebase Storage. The uid
// comes from the verified token, so a user can only set their own photo.
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.id) return NextResponse.json({ error: 'no_linked_attenddesk_user' }, { status: 400 });
  // The env system admin has no employee row and no Firebase account, so a photo
  // would write a Storage object nothing ever reads plus a 0-row UPDATE.
  if (user.id === 'sysadmin') {
    return NextResponse.json({ error: 'The system admin account has no employee profile.' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const dataUrl = body?.dataUrl;
  if (!dataUrl || !/^data:image\//i.test(dataUrl)) {
    return NextResponse.json({ error: 'A valid image is required' }, { status: 400 });
  }

  try {
    const data = await uploadPhoto(user.id, dataUrl, user.orgId);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message, upstream: err.body ?? null }, { status: err.status || 502 });
  }
}
