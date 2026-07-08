import { sql } from '../db';
import { tsToIso } from '../rows';
import { getEmployees } from './users';

// Teams — ported from AttendDesk. Leader is an employee uid + denormalized name.

export async function getTeams(orgId) {
  const rows = await sql`
    SELECT id, name, leader_uid, leader_name, created_at
      FROM teams
     WHERE org_id = ${orgId}
     ORDER BY name ASC
  `;
  const teams = rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    leaderUid: r.leader_uid ?? null,
    leaderName: r.leader_name ?? null,
    createdAt: tsToIso(r.created_at),
  }));
  return { teams };
}

// The line manager for a team = its (denormalized) leader name. Returns null
// when the user has no team or the team has no leader.
export async function getLineManager(orgId, teamId) {
  if (!teamId) return null;
  const rows = await sql`
    SELECT leader_name FROM teams WHERE id = ${teamId} AND org_id = ${orgId}
  `;
  if (rows.length === 0) return null;
  return rows[0].leader_name || null;
}

// body: { name, leaderUid? }
export async function createTeam(body, orgId) {
  let leaderUid = body.leaderUid ?? null;
  let leaderName = null;
  if (leaderUid) {
    const u = await sql`
      SELECT name FROM users WHERE firebase_uid = ${leaderUid} AND org_id = ${orgId}
    `;
    if (u.length > 0) leaderName = u[0].name ?? null;
    else leaderUid = null;
  }
  const rows = await sql`
    INSERT INTO teams (org_id, name, leader_uid, leader_name, created_at, created_by)
    VALUES (${orgId}, ${body.name}, ${leaderUid}, ${leaderName}, now(), 'lexdesk')
    RETURNING id
  `;
  return { id: rows[0].id };
}

// body: { name?, leaderUid? }  (leaderUid:null clears the leader)
export async function updateTeam(id, body, orgId) {
  const existing = await sql`
    SELECT name, leader_uid, leader_name FROM teams WHERE id = ${id} AND org_id = ${orgId}
  `;
  if (existing.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
  const data = existing[0];
  const name = body.name !== undefined ? body.name : (data.name ?? '');
  let leaderUid = data.leader_uid ?? null;
  let leaderName = data.leader_name ?? null;
  if (body.leaderUid !== undefined) {
    if (body.leaderUid) {
      const u = await sql`
        SELECT name FROM users WHERE firebase_uid = ${body.leaderUid} AND org_id = ${orgId}
      `;
      leaderUid = body.leaderUid;
      leaderName = u.length > 0 ? (u[0].name ?? null) : null;
    } else {
      leaderUid = null;
      leaderName = null;
    }
  }
  await sql`
    UPDATE teams
       SET name = ${name}, leader_uid = ${leaderUid}, leader_name = ${leaderName}
     WHERE id = ${id} AND org_id = ${orgId}
  `;
  return { ok: true };
}

export async function deleteTeam(id, orgId) {
  const existing = await sql`
    SELECT id FROM teams WHERE id = ${id} AND org_id = ${orgId}
  `;
  if (existing.length === 0) throw Object.assign(new Error('not_found'), { status: 404 });
  await sql`DELETE FROM teams WHERE id = ${id} AND org_id = ${orgId}`;
  return { ok: true };
}

// Resolve the teams this uid LEADS and the member uids in them. Mirrors the
// web /api/team/* routes (getTeams + getEmployees filter). Used by mobile
// manager endpoints for scoping (a lead only acts on their team's members).
export async function listLedTeamMemberUids(orgId, uid) {
  const { teams } = await getTeams(orgId);
  const ledTeamIds = new Set(
    teams.filter((t) => String(t.leaderUid) === String(uid)).map((t) => t.id),
  );
  if (ledTeamIds.size === 0) return { isLeader: false, members: [], memberUids: new Set() };
  const { employees } = await getEmployees(orgId);
  const members = employees.filter((e) => e.teamId && ledTeamIds.has(e.teamId));
  return { isLeader: true, members, memberUids: new Set(members.map((e) => String(e.id))) };
}

// True when this caller can approve requests at all: an admin/superadmin (any
// role casing) or the leader of ≥1 team.
export async function isManager(orgId, uid, role) {
  const r = String(role ?? '').toUpperCase();
  if (r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'SUPERADMIN') return true;
  const { isLeader } = await listLedTeamMemberUids(orgId, uid);
  return isLeader;
}

// True when this caller may act on a SPECIFIC request owner (admin → anyone;
// lead → only their team members).
export async function canManageUser(orgId, uid, role, targetUid) {
  const r = String(role ?? '').toUpperCase();
  if (r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'SUPERADMIN') return true;
  const { memberUids } = await listLedTeamMemberUids(orgId, uid);
  return memberUids.has(String(targetUid));
}
