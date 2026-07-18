import { makeMineGet, makeMinePost } from '@/lib/mobileRequestRoutes';
import { listMyRemote, submitRemote } from '@/lib/services/remote';

export const dynamic = 'force-dynamic';

export const GET = makeMineGet(listMyRemote);
// POST = START a remote work session (day is auto-stamped server-side to today).
export const POST = makeMinePost(submitRemote, ['reason']);
