import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Keep-warm ping for Neon. The free tier auto-suspends the compute after ~5 min
// idle, so the first real request after a quiet spell pays a cold-start wake and
// can time out ("couldn't load…"). A Vercel Cron hits this every few minutes
// during work hours (see vercel.json) to keep the compute awake so employees
// never hit that. It runs one trivial query — no data is read or returned.
//
// If CRON_SECRET is set, require it (Vercel Cron sends Authorization: Bearer
// <CRON_SECRET>); otherwise the endpoint is open but harmless.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    await sql`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
