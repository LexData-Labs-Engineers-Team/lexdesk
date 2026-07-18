import { NextResponse } from 'next/server';
import { getMobileUser, mobileAuthError } from '@/lib/mobileAuth';
import { listLedTeamMemberUids } from '@/lib/services/teams';
import { listAttendance } from '@/lib/services/attendance';
import { dhakaDay, lastSevenDays, memberSummary, indexEventsByUid } from '@/lib/attendSummary';

export const dynamic = 'force-dynamic';

// GET /api/v1/me/team-summary — for a team leader, each member's last-7-day
// attendance summary + today's in/out. Non-leaders get { isLeader:false }.
export async function GET(request) {
  let user;
  try { user = await getMobileUser(request); } catch (e) { return mobileAuthError(e); }
  try {
    const { isLeader, members } = await listLedTeamMemberUids(user.orgId, user.uid);
    if (!isLeader) return NextResponse.json({ isLeader: false, members: [] });

    // Bound to the trailing window so the 1000-event cap reflects the 7-day
    // window instead of silently truncating older days for a busy org.
    const from = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { events } = await listAttendance(user.orgId, { from, limit: 1000 });
    const today = dhakaDay(new Date().toISOString());
    const last7 = lastSevenDays(Date.now());
    const byUid = indexEventsByUid(events);

    const summary = members.map((m) => ({
      uid: m.id,
      name: m.name || m.email || '',
      email: m.email || '',
      ...memberSummary(byUid[String(m.id)] || [], last7, today),
    }));
    return NextResponse.json({ isLeader: true, members: summary });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 500 }); }
}
