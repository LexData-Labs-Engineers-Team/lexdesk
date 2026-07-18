'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { apiFetch } from '@/lib/apiFetch';

function initialsFromName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Normalize a stored date (plain 'YYYY-MM-DD' or full ISO) to the value an
// <input type="date"> expects.
function toDateInput(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-[var(--color-card-border)] last:border-0">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="text-[var(--color-text-main)] font-medium truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

const inputCls =
  'bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]';

// Downscale an image to a small JPEG data URL so it fits in localStorage.
function fileToResizedDataUrl(file, maxSize = 512) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height >= width && height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function MyProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [adProfile, setAdProfile] = useState(null);
  const [office, setOffice] = useState(null);

  const [editing, setEditing] = useState(false);
  const [formName, setFormName] = useState('');
  const [formImage, setFormImage] = useState(null);
  const [formDesignation, setFormDesignation] = useState('');
  const [formDepartment, setFormDepartment] = useState('');
  const [formBirthDate, setFormBirthDate] = useState('');
  const [formContact, setFormContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      if (!stored) { router.push('/register'); return; }
      setUser(stored);
    } catch {
      router.push('/register');
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const headers = { Authorization: `Bearer ${token}` };
        const [profRes, offRes] = await Promise.all([
          apiFetch('/api/me/profile', { headers, cache: 'no-store' }),
          apiFetch('/api/me/office', { headers, cache: 'no-store' }),
        ]);
        const profJson = await profRes.json().catch(() => ({}));
        const offJson = await offRes.json().catch(() => ({}));
        if (!active) return;
        if (profRes.ok) setAdProfile(profJson.profile || null);
        if (offRes.ok) setOffice(offJson || null);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, []);

  if (!user) return null;

  const displayName = adProfile?.name || user.name;
  const photo = adProfile?.photoUrl || user.avatarImage || null;

  const startEdit = () => {
    setFormName(displayName || '');
    setFormImage(null);
    setFormDesignation(adProfile?.designation || '');
    setFormDepartment(adProfile?.department || '');
    setFormBirthDate(toDateInput(adProfile?.birthDate));
    setFormContact(adProfile?.contactNumber || '');
    setError('');
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setError(''); };

  const handlePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setFormImage(dataUrl);
      setError('');
    } catch {
      setError('Could not read that image. Try another one.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    const name = formName.trim();
    if (!name) { setError('Name cannot be empty.'); return; }
    setSaving(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

      // 1) Profile fields (name + self-service details) — saved to AttendDesk.
      const designation = formDesignation.trim() || null;
      const department = formDepartment.trim() || null;
      const contactNumber = formContact.trim() || null;
      const birthDate = formBirthDate || null;
      {
        const res = await fetch('/api/me/profile', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ name, designation, department, contactNumber, birthDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save profile');
      }

      // 2) Photo — only if a new one was picked (a data URL) → uploads to AttendDesk.
      let newPhotoUrl = null;
      if (formImage && formImage.startsWith('data:')) {
        const res = await fetch('/api/me/photo', { method: 'POST', headers: authHeaders, body: JSON.stringify({ dataUrl: formImage }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to upload photo');
        newPhotoUrl = data.photoUrl || null;
      }

      const updated = { ...user, name, avatar: initialsFromName(name) };
      try { localStorage.setItem('user', JSON.stringify(updated)); } catch { /* ignore */ }
      setUser(updated);
      setAdProfile((p) => ({ ...(p || {}), name, designation, department, contactNumber, birthDate, photoUrl: newPhotoUrl || p?.photoUrl || null }));
      setEditing(false);
      window.dispatchEvent(new Event('user-updated'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');
    if (!pw.current || !pw.next) { setPwError('Enter your current and new password.'); return; }
    if (pw.next.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    if (pw.next !== pw.confirm) { setPwError('New password and confirmation do not match.'); return; }
    setPwBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      setPw({ current: '', next: '', confirm: '' });
      setPwSuccess('Password changed.');
      setTimeout(() => setPwSuccess(''), 4000);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My Profile" subtitle="Manage your account and password" />

      <div className="flex flex-col lg:flex-row gap-6 justify-center items-start">
        {/* Left: profile card — read-only; the ⋮ button opens the edit modal. */}
        <div className="card relative flex flex-col items-center text-center !p-0 overflow-hidden w-full max-w-sm">
          {/* ⋮ menu — edit this profile */}
          <button
            type="button"
            onClick={startEdit}
            className="absolute top-2 right-2 p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-accent-soft)] transition-colors"
            title="Edit profile"
            aria-label="Edit profile"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
          </button>

          {/* Avatar + name + designation */}
          <div className="flex flex-col items-center pt-5 pb-3 px-4">
            <Avatar
              image={photo}
              initials={user.avatar || initialsFromName(displayName)}
              alt={displayName}
              className="w-14 h-14 text-base font-bold ring-2 ring-[var(--color-card-border)]"
            />
            <h3 className="mt-2 text-sm font-semibold text-[var(--color-text-main)]">{displayName}</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{adProfile?.designation || (user.role || '').toLowerCase() || 'Employee'}</p>
            {adProfile?.faceEnrolledAt && (
              <span className="mt-1 inline-block px-2 py-0.5 rounded-full bg-[rgba(34,197,94,0.15)] text-[var(--color-green)] text-[0.6rem] font-semibold">
                Face enrolled
              </span>
            )}
          </div>

          {/* Contact */}
          <div className="w-full px-5 py-2.5 flex flex-col gap-1.5 text-xs border-t border-[var(--color-card-border)]">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
              <span className="truncate text-[var(--color-text-main)]">{user.email || adProfile?.email || '—'}</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
              <span className="truncate text-[var(--color-text-main)]">{adProfile?.contactNumber || '—'}</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8" /></svg>
              <span className="truncate text-[var(--color-text-main)]">{fmtDate(adProfile?.birthDate)}</span>
            </div>
          </div>

          {/* Employee ID / department / joining — tinted footer */}
          <div className="w-full px-5 py-3 flex flex-col gap-1.5 text-xs" style={{ background: 'var(--color-accent-soft)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">Employee ID</span>
              <span className="font-semibold text-[var(--color-text-main)] font-mono truncate">{adProfile?.employeeId || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">Department</span>
              <span className="font-semibold text-[var(--color-text-main)] truncate">{adProfile?.department || adProfile?.teamName || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">Branch</span>
              <span className="font-semibold text-[var(--color-text-main)] truncate">{office?.name || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">Date of Joining</span>
              <span className="font-semibold text-[var(--color-text-main)]">{fmtDate(adProfile?.joiningDate)}</span>
            </div>
          </div>
        </div>

        {/* Right: Change Password — updates the AttendDesk sign-in password */}
        <div className="card w-full max-w-md">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-lg text-[var(--color-text-main)]">Change Password</h3>
            <button type="button" onClick={() => setShowPw((v) => !v)} className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mb-5">Updates your AttendDesk sign-in password (web, mobile, and kiosk).</p>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Current password</label>
              <input type={showPw ? 'text' : 'password'} autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">New password</label>
                <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Confirm new password</label>
                <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)]" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">Use at least 8 characters.</p>
            {pwError && <p className="text-sm text-[var(--color-red)]">{pwError}</p>}
            {pwSuccess && <p className="text-sm text-[var(--color-green)]">{pwSuccess}</p>}
            <div>
              <button type="submit" disabled={pwBusy} className="btn-primary py-2 px-5 text-sm disabled:opacity-60">{pwBusy ? 'Saving…' : 'Update password'}</button>
            </div>
          </form>
        </div>
      </div>

      {/* Edit profile modal — opens from the card's Edit button. */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={cancelEdit}>
          <div className="card glossy w-full max-w-lg flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-main)]">Edit profile</h2>
              <button type="button" onClick={cancelEdit} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-lg leading-none" aria-label="Close">✕</button>
            </div>

            {/* Avatar + change photo */}
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <Avatar image={formImage || photo} initials={initialsFromName(formName)} alt={formName} className="w-16 h-16 text-lg font-bold" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] flex items-center justify-center shadow-md hover:opacity-90"
                  title="Change photo"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePick} className="hidden" />
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Profile photo
                {formImage && <button type="button" onClick={() => setFormImage(null)} className="ml-2 text-[var(--color-red)] hover:underline">Clear</button>}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Full name</label>
              <input type="text" maxLength={80} value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Your name" className={inputCls} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Designation</label>
                <input type="text" maxLength={80} value={formDesignation} onChange={(e) => setFormDesignation(e.target.value)} placeholder="e.g. Software Engineer" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Department</label>
                <input type="text" maxLength={80} value={formDepartment} onChange={(e) => setFormDepartment(e.target.value)} placeholder="e.g. Engineering" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Contact number</label>
                <input type="tel" maxLength={30} value={formContact} onChange={(e) => setFormContact(e.target.value)} placeholder="e.g. +880 1XXX-XXXXXX" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Date of birth</label>
                <input type="date" value={formBirthDate} onChange={(e) => setFormBirthDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Email</label>
              <input type="email" value={user.email || adProfile?.email || ''} readOnly disabled className={`${inputCls} opacity-60 cursor-not-allowed`} />
            </div>

            {error && <p className="text-sm text-[var(--color-red)]">{error}</p>}
            <p className="text-xs text-[var(--color-text-muted)] -mt-1">Your profile details are saved to AttendDesk and sync everywhere. Employee ID, branch, joining date and email are managed by your admin.</p>
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={cancelEdit} disabled={saving} className="btn-outline py-2 px-4 text-sm">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary py-2 px-5 text-sm disabled:opacity-60">{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
