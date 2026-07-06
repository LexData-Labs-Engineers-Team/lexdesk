'use client';

import { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import EmployeeAvatar from '@/components/EmployeeAvatar';
import { useAttendData } from '@/lib/useAttendData';
import { eventsForUser, perEmployeeStats, fmtTime, isLateCheckIn } from '@/lib/attend';

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const employeeId = decodeURIComponent(id);
  const { employees, events, loading, error, refresh } = useAttendData(['employees', 'attendance']);
  const [avatar, setAvatar] = useState(null);
  const [teams, setTeams] = useState([]);
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamMsg, setTeamMsg] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [resetError, setResetError] = useState('');
  const [copied, setCopied] = useState(false);
  const [faceResetting, setFaceResetting] = useState(false);
  const [faceMsg, setFaceMsg] = useState(null); // { ok, text }
  const [devResetting, setDevResetting] = useState(false);
  const [devMsg, setDevMsg] = useState(null); // { ok, text }
  const [ipDraft, setIpDraft] = useState('');
  const [savingIps, setSavingIps] = useState(false);
  const [ipMsg, setIpMsg] = useState(null); // { ok, text }

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      setCurrentUserId(u?.id ?? null);
      setCurrentUserRole(u?.role ?? null);
    } catch { setCurrentUserId(null); setCurrentUserRole(null); }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') setAvatar(localStorage.getItem('avatar-' + employeeId));
  }, [employeeId]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/teams', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((j) => setTeams(j.teams || []))
      .catch(() => setTeams([]));
  }, []);

  const employee = useMemo(
    () => (employees || []).find((e) => String(e.id) === employeeId) || null,
    [employees, employeeId],
  );
  const stats = useMemo(
    () => perEmployeeStats(events)[employeeId] || { presentDays: 0, lateDays: 0, lastCheckIn: null },
    [events, employeeId],
  );
  const myEvents = useMemo(
    () =>
      eventsForUser(events, employeeId)
        .filter((e) => e.timestamp)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [events, employeeId],
  );

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      localStorage.setItem('avatar-' + employeeId, data);
      setAvatar(data);
    };
    reader.readAsDataURL(file);
  };
  const removeAvatar = () => {
    localStorage.removeItem('avatar-' + employeeId);
    setAvatar(null);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${employee?.name || 'this employee'}? This permanently removes their sign-in account. Past attendance/leave/asset records are kept.`)) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.push('/dashboard/people?tab=employees');
    } catch (e) {
      alert(e.message);
      setDeleting(false);
    }
  };

  const confirmReset = async () => {
    setResetting(true);
    setResetError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResetResult({ email: json.email, temporaryPassword: json.temporaryPassword });
    } catch (e) {
      setResetError(e.message);
    } finally {
      setResetting(false);
    }
  };
  const copyResetPw = async () => {
    try {
      await navigator.clipboard.writeText(resetResult.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };
  const closeReset = () => { setResetOpen(false); setResetResult(null); setResetError(''); setCopied(false); };

  const handleResetFace = async () => {
    if (!window.confirm(`Reset face enrollment for ${employee?.name || 'this employee'}? They'll need to enroll their face again before face check-ins work.`)) return;
    setFaceResetting(true);
    setFaceMsg(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/reset-face`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setFaceMsg({ ok: true, text: 'Face enrollment cleared — they can enroll again now.' });
      refresh();
    } catch (e) {
      setFaceMsg({ ok: false, text: e.message });
    } finally {
      setFaceResetting(false);
    }
  };

  // Keep the IP-allowlist textarea in sync with the loaded employee (one line per
  // entry). Reset during render when the source changes — React's sanctioned
  // alternative to a setState-in-effect (avoids cascading renders).
  const savedIps = (employee?.loginIpAllowlist || []).join('\n');
  const [ipSync, setIpSync] = useState({ id: null, ips: '' });
  if (ipSync.id !== employeeId || ipSync.ips !== savedIps) {
    setIpSync({ id: employeeId, ips: savedIps });
    setIpDraft(savedIps);
  }

  const handleResetDevices = async () => {
    if (!window.confirm(`Reset registered devices for ${employee?.name || 'this employee'}? They'll be able to sign in on new devices (up to 2).`)) return;
    setDevResetting(true);
    setDevMsg(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/reset-devices`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDevMsg({ ok: true, text: `Cleared ${json.cleared ?? 0} device(s). They can register new ones now.` });
      refresh();
    } catch (e) {
      setDevMsg({ ok: false, text: e.message });
    } finally {
      setDevResetting(false);
    }
  };

  const saveLoginIps = async () => {
    setSavingIps(true);
    setIpMsg(null);
    try {
      const token = localStorage.getItem('token');
      const allowlist = ipDraft.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/login-ips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ allowlist }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setIpMsg({ ok: true, text: allowlist.length ? 'Login IP allowlist saved.' : 'Allowlist cleared — sign-in allowed from any network.' });
      refresh();
    } catch (e) {
      setIpMsg({ ok: false, text: e.message });
    } finally {
      setSavingIps(false);
    }
  };

  const saveTeam = async (teamId) => {
    setSavingTeam(true);
    setTeamMsg('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId: teamId || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTeamMsg('Team updated.');
      setTimeout(() => setTeamMsg(''), 3000);
      refresh();
    } catch (e) {
      setTeamMsg(e.message);
    } finally {
      setSavingTeam(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={employee?.name || `Employee ${employeeId}`}
        subtitle="Employee profile · AttendDesk"
        actions={
          <div className="flex items-center gap-3">
            <Link href="/dashboard/people?tab=employees" className="btn-outline py-1.5 px-3 text-sm">Back</Link>
            <button onClick={refresh} className="btn-outline py-1.5 px-3 text-sm">Refresh</button>
            {employee && String(employeeId) !== String(currentUserId) &&
              (['EMPLOYEE', 'DEV'].includes(String(employee.role || '').toUpperCase()) ||
                (String(employee.role || '').toUpperCase() === 'ADMIN' && currentUserRole === 'superadmin')) && (
              <button onClick={() => { setResetResult(null); setResetError(''); setResetOpen(true); }} className="btn-outline py-1.5 px-3 text-sm text-[var(--color-purple)] border-[rgba(150,150,150,0.3)] hover:bg-[rgba(150,150,150,0.05)]">
                Reset password
              </button>
            )}
            {employee && ['EMPLOYEE', 'DEV'].includes(String(employee.role || '').toUpperCase()) && employee.faceEnrolledAt && (
              <button onClick={handleResetFace} disabled={faceResetting} className="btn-outline py-1.5 px-3 text-sm text-[var(--color-yellow)] border-[rgba(234,179,8,0.3)] hover:bg-[rgba(234,179,8,0.05)] disabled:opacity-50">
                {faceResetting ? 'Resetting…' : 'Reset face'}
              </button>
            )}
            {employee && String(employeeId) !== String(currentUserId) && (
              <button onClick={handleDelete} disabled={deleting} className="btn-outline py-1.5 px-3 text-sm text-[var(--color-red)] border-[rgba(239,68,68,0.3)] hover:bg-[rgba(239,68,68,0.05)] disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete employee'}
              </button>
            )}
          </div>
        }
      />

      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeReset}>
          <div className="card glossy w-full max-w-sm sm:max-w-md flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            {resetResult ? (
              <>
                <h3 className="font-semibold text-lg text-[var(--color-text-main)]">Password reset</h3>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Share this temporary password with <span className="text-[var(--color-text-main)]">{resetResult.email}</span>. They should change it after signing in (My Profile → Change Password).
                </p>
                <div className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-3 flex items-center justify-between gap-3">
                  <code className="font-mono text-sm text-[var(--color-text-main)] break-all">{resetResult.temporaryPassword}</code>
                  <button onClick={copyResetPw} className="btn-outline py-1 px-2.5 text-xs shrink-0">{copied ? 'Copied' : 'Copy'}</button>
                </div>
                <div className="flex justify-end pt-1">
                  <button onClick={closeReset} className="btn-primary py-2 px-5 text-sm">Done</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-lg text-[var(--color-text-main)]">Reset password?</h3>
                <p className="text-sm text-[var(--color-text-muted)]">
                  This generates a new temporary password for <span className="text-[var(--color-text-main)]">{employee?.name || 'this employee'}</span> and signs them out of all sessions.
                </p>
                {resetError && <div className="text-sm text-[var(--color-red)]">{resetError}</div>}
                <div className="flex gap-2 justify-end pt-1">
                  <button onClick={closeReset} disabled={resetting} className="btn-outline py-2 px-4 text-sm">Cancel</button>
                  <button onClick={confirmReset} disabled={resetting} className="btn-primary py-2 px-5 text-sm disabled:opacity-50">
                    {resetting ? 'Resetting…' : 'Reset password'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && <div className="card text-[var(--color-red)] text-sm">{error}</div>}
      {faceMsg && <div className={`card text-sm ${faceMsg.ok ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}`}>{faceMsg.text}</div>}
      {loading && !employee && <div className="card text-[var(--color-text-muted)] text-sm">Loading…</div>}
      {!loading && !employee && <div className="card text-[var(--color-text-muted)] text-sm">Employee not found.</div>}

      {employee && (
        <>
          <div className="card flex items-center gap-6 flex-wrap">
            <div className="relative">
              {avatar ? (
                <div className="w-24 h-24 rounded-full bg-cover bg-center border-2 border-[var(--color-purple)]" style={{ backgroundImage: `url(${avatar})` }} />
              ) : (
                <EmployeeAvatar id={employeeId} name={employee.name} size={96} />
              )}
            </div>
            <div className="flex-1 min-w-[240px]">
              <h2 className="text-xl font-semibold text-[var(--color-text-main)]">{employee.name}</h2>
              {employee.designation && <p className="text-sm text-[var(--color-purple)]">{employee.designation}</p>}
              <p className="text-sm text-[var(--color-text-muted)]">{employee.email}</p>
              {employee.employeeId && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">ID: {employee.employeeId}</p>}
              <p className="text-xs text-[var(--color-text-muted)] mt-1 capitalize">
                {(employee.role || '').toLowerCase()}{employee.faceEnrolledAt ? ' · face enrolled' : ''}
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-xs">
                {(employee.department || employee.teamName) && <div><span className="text-[var(--color-text-muted)]">Department: </span><span className="text-[var(--color-text-main)]">{employee.department || employee.teamName}</span></div>}
                {employee.contactNumber && <div><span className="text-[var(--color-text-muted)]">Contact: </span><span className="text-[var(--color-text-main)]">{employee.contactNumber}</span></div>}
                {employee.joiningDate && <div><span className="text-[var(--color-text-muted)]">Joined: </span><span className="text-[var(--color-text-main)]">{fmtDate(employee.joiningDate)}</span></div>}
                {employee.birthDate && <div><span className="text-[var(--color-text-muted)]">Born: </span><span className="text-[var(--color-text-main)]">{fmtDate(employee.birthDate)}</span></div>}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-[var(--color-text-muted)]">Team</span>
                <select
                  value={employee.teamId || ''}
                  onChange={(e) => saveTeam(e.target.value)}
                  disabled={savingTeam}
                  className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text-main)]"
                >
                  <option value="">— no team —</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {teamMsg && <span className="text-xs text-[var(--color-green)]">{teamMsg}</span>}
              </div>
              <div className="flex gap-3 mt-3">
                <label className="btn-outline py-1.5 px-3 text-xs cursor-pointer">
                  Upload Photo
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </label>
                {avatar && <button onClick={removeAvatar} className="btn-outline py-1.5 px-3 text-xs text-[var(--color-red)] border-[rgba(239,68,68,0.3)]">Remove</button>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="card text-center"><p className="text-xs text-[var(--color-text-muted)]">Present days</p><p className="text-2xl font-bold text-[var(--color-green)] mt-1">{stats.presentDays}</p></div>
            <div className="card text-center"><p className="text-xs text-[var(--color-text-muted)]">Late</p><p className="text-2xl font-bold text-[var(--color-yellow)] mt-1">{stats.lateDays}</p></div>
            <div className="card text-center"><p className="text-xs text-[var(--color-text-muted)]">Last seen</p><p className="text-sm font-semibold text-[var(--color-text-main)] mt-2">{stats.lastCheckIn ? fmtTime(stats.lastCheckIn) : '—'}</p></div>
          </div>

          {(() => {
            const tr = String(employee.role || '').toUpperCase();
            if (tr !== 'EMPLOYEE' && tr !== 'IT_TEAM') return null;
            const devices = employee.loginDevices || [];
            const fmtSeen = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleString(); };
            return (
              <div className="card flex flex-col gap-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-semibold text-lg text-[var(--color-text-main)]">Login security</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Max 2 sign-in devices · optional per-employee IP allowlist</p>
                  </div>
                </div>

                {/* Registered devices */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--color-text-main)]">Registered devices ({devices.length}/2)</span>
                    <button
                      onClick={handleResetDevices}
                      disabled={devResetting || devices.length === 0}
                      className="btn-outline py-1.5 px-3 text-sm text-[var(--color-yellow)] border-[rgba(234,179,8,0.3)] hover:bg-[rgba(234,179,8,0.05)] disabled:opacity-50"
                    >
                      {devResetting ? 'Resetting…' : 'Reset devices'}
                    </button>
                  </div>
                  {devices.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">No devices registered yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {devices.map((d) => (
                        <li key={d.deviceId} className="flex items-center justify-between gap-3 bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm">
                          <span className="text-[var(--color-text-main)] truncate">
                            <span className="text-[10px] font-bold uppercase mr-2 px-1 py-0.5 rounded bg-[rgba(150,150,150,0.15)] text-[var(--color-purple)]">{d.platform || '—'}</span>
                            {d.name || d.deviceId}
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">last seen {fmtSeen(d.lastSeenAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {devMsg && <p className={`text-sm ${devMsg.ok ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}`}>{devMsg.text}</p>}
                </div>

                {/* Login IP allowlist */}
                <div className="flex flex-col gap-2 border-t border-[var(--color-card-border)] pt-4">
                  <label className="text-sm font-medium text-[var(--color-text-main)]">Login IP allowlist</label>
                  <p className="text-xs text-[var(--color-text-muted)]">One IP or CIDR per line. Leave empty to allow sign-in from any network. Note: mobile networks change IPs often — set this only for network-locked users.</p>
                  <textarea
                    rows={3}
                    value={ipDraft}
                    onChange={(e) => setIpDraft(e.target.value)}
                    placeholder="e.g. 203.0.113.42 or 203.0.113.0/24"
                    className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)] resize-y font-mono"
                  />
                  <div className="flex items-center gap-3">
                    <button onClick={saveLoginIps} disabled={savingIps || ipDraft === savedIps} className="btn-primary py-1.5 px-4 text-sm disabled:opacity-50">
                      {savingIps ? 'Saving…' : 'Save allowlist'}
                    </button>
                    {ipMsg && <span className={`text-sm ${ipMsg.ok ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}`}>{ipMsg.text}</span>}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="card overflow-hidden p-0">
            <div className="px-5 py-4 border-b border-[var(--color-card-border)]">
              <h3 className="font-semibold text-lg">Check-in / out history</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--color-text-muted)] text-xs border-b border-[var(--color-card-border)]">
                    <th className="py-3 px-5 font-medium">When</th>
                    <th className="py-3 px-5 font-medium">Type</th>
                    <th className="py-3 px-5 font-medium">Status</th>
                    <th className="py-3 px-5 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {myEvents.slice(0, 100).map((e) => (
                    <tr key={e.id} className="border-t border-[var(--color-card-border)] hover:bg-white/[0.02]">
                      <td className="py-3 px-5 whitespace-nowrap">{fmtTime(new Date(e.timestamp).getTime())}</td>
                      <td className="py-3 px-5">{e.type === 'CHECK_IN' ? 'Check in' : e.type === 'CHECK_OUT' ? 'Check out' : e.type}</td>
                      <td className="py-3 px-5">{isLateCheckIn(e) ? <span className="text-[var(--color-yellow)]">Late</span> : <span className="text-[var(--color-green)]">On time</span>}</td>
                      <td className="py-3 px-5 text-xs text-[var(--color-text-muted)]">{e.clientMode || 'mobile'}</td>
                    </tr>
                  ))}
                  {myEvents.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-[var(--color-text-muted)]">No events yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
