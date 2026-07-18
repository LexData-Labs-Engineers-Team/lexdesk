import { sql } from '../db';
import { buildInsert } from '../rows';
import { setEmployeeRole } from './users';

// Management-role assignment. Two assignable roles:
//   - team_leader: tied to a department. A department is represented as a team
//                  (created on demand) so existing team-leader plumbing
//                  (approvals, scoping) keeps working. The employee is placed on
//                  the department's team and set as its leader; their account
//                  role stays EMPLOYEE.
//   - it:          a standalone account role (IT_TEAM), not tied to a department.
export const DEPARTMENTS = ['Engineering', 'Marketing', 'Project'];
const ROLES = ['team_leader', 'it', 'dev'];

async function findOrCreateDeptTeam(orgId, department) {
  const existing = await sql`
    SELECT id, name FROM teams
    WHERE org_id = ${orgId} AND lower(name) = ${department.toLowerCase()}
    LIMIT 1
  `;
  if (existing.length) return { id: existing[0].id, name: existing[0].name };

  const { text, params } = buildInsert(
    'teams',
    {
      orgId,
      name: department,
      leaderUid: null,
      leaderName: null,
      createdBy: 'lexdesk',
    },
    { returning: 'id, name' },
  );
  const rows = await sql.query(text, params);
  return { id: rows[0].id, name: rows[0].name };
}

export async function assignManagementRole(orgId, { uid, department, role }) {
  if (!uid) throw Object.assign(new Error('Select an employee'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('Pick a valid role'), { status: 400 });

  const userRows = await sql`
    SELECT name, role FROM users
    WHERE firebase_uid = ${uid} AND org_id = ${orgId}
    LIMIT 1
  `;
  if (!userRows.length) throw Object.assign(new Error('not_found'), { status: 404 });
  const data = userRows[0];
  const current = String(data.role || '').toUpperCase();
  if (current === 'ADMIN' || current === 'SUPER_ADMIN') {
    throw Object.assign(new Error('cannot_change_admin_role'), { status: 403 });
  }

  if (role === 'team_leader') {
    if (!DEPARTMENTS.includes(department)) throw Object.assign(new Error('Pick a valid department'), { status: 400 });
    const team = await findOrCreateDeptTeam(orgId, department);
    const teamName = team.name ?? department;
    await sql`
      UPDATE users
      SET department = ${department}, team_id = ${team.id}, team_name = ${teamName}
      WHERE firebase_uid = ${uid} AND org_id = ${orgId}
    `;
    await sql`
      UPDATE teams
      SET leader_uid = ${uid}, leader_name = ${data.name ?? null}
      WHERE id = ${team.id} AND org_id = ${orgId}
    `;
    return { ok: true, role: 'team_leader', department };
  }

  if (role === 'it') {
    // IT — a standalone role, not tied to a department.
    await setEmployeeRole(uid, 'IT_TEAM', orgId);
    return { ok: true, role: 'it' };
  }

  // Dev — hybrid: stays an employee (checks in, tracked) but gains full
  // org-admin permissions. Not tied to a department.
  await setEmployeeRole(uid, 'DEV', orgId);
  return { ok: true, role: 'dev' };
}
