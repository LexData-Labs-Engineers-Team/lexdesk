import { sql } from '../db';
import { tsToIso } from '../rows';

// Custom org holidays — inclusive [fromDay, toDay] day ranges. Ported from AttendDesk.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function getHolidays(orgId) {
  const rows = await sql`
    SELECT id, from_day, to_day, name, created_at
    FROM holidays
    WHERE org_id = ${orgId}
    ORDER BY from_day ASC
  `;
  const holidays = rows.map((data) => ({
    id: data.id,
    fromDay: data.from_day ?? null,
    toDay: data.to_day ?? data.from_day ?? null,
    name: data.name ?? '',
    createdAt: tsToIso(data.created_at),
  }));
  return { holidays };
}

// body: { fromDay, toDay?, name }
export async function createHoliday(body, orgId) {
  if (!ISO_DAY.test(body.fromDay || '')) throw Object.assign(new Error('invalid_range'), { status: 400 });
  const toDay = body.toDay ?? body.fromDay;
  if (!ISO_DAY.test(toDay)) throw Object.assign(new Error('invalid_range'), { status: 400 });
  if (body.fromDay > toDay) throw Object.assign(new Error('invalid_range'), { status: 400 });
  const rows = await sql`
    INSERT INTO holidays (org_id, from_day, to_day, name, created_at, created_by)
    VALUES (${orgId}, ${body.fromDay}, ${toDay}, ${body.name}, now(), 'lexdesk')
    RETURNING id
  `;
  return { id: rows[0].id };
}

export async function deleteHoliday(id, orgId) {
  const rows = await sql`
    DELETE FROM holidays
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING id
  `;
  if (rows.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
  return { ok: true };
}
