import { firebaseAdmin, FieldValue } from '../firebase';
import { Paths } from '../paths';
import { getTeams } from './teams';
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

async function findOrCreateDeptTeam(db, orgId, department) {
  const { teams } = await getTeams(orgId);
  const existing = teams.find((t) => t.name.toLowerCase() === department.toLowerCase());
  if (existing) return existing.id;
  const ref = await db.collection(Paths.teams(orgId)).add({
    name: department,
    leaderUid: null,
    leaderName: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'lexdesk',
  });
  return ref.id;
}

export async function assignManagementRole(orgId, { uid, department, role }) {
  if (!uid) throw Object.assign(new Error('Select an employee'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('Pick a valid role'), { status: 400 });

  const { db } = firebaseAdmin();
  const userRef = db.doc(Paths.user(orgId, uid));
  const snap = await userRef.get();
  if (!snap.exists) throw Object.assign(new Error('not_found'), { status: 404 });
  const data = snap.data() ?? {};
  const current = String(data.role || '').toUpperCase();
  if (current === 'ADMIN' || current === 'SUPER_ADMIN') {
    throw Object.assign(new Error('cannot_change_admin_role'), { status: 403 });
  }

  if (role === 'team_leader') {
    if (!DEPARTMENTS.includes(department)) throw Object.assign(new Error('Pick a valid department'), { status: 400 });
    const teamId = await findOrCreateDeptTeam(db, orgId, department);
    const teamSnap = await db.doc(Paths.team(orgId, teamId)).get();
    const teamName = teamSnap.data()?.name ?? department;
    await userRef.update({ department, teamId, teamName });
    await db.doc(Paths.team(orgId, teamId)).set(
      { leaderUid: uid, leaderName: data.name ?? null },
      { merge: true },
    );
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
