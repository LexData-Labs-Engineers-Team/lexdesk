'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';

const ROLE_LABEL = {
  admin: 'Administrator',
  superadmin: 'Super Admin',
  employee: 'Employee',
  dev: 'Dev',
  lexsysadmin: 'System Admin',
};

// Avatar button on the top-right that opens an information card (name, email,
// role, profile link, sign out). Closes on outside-click or Escape.
export default function ProfileMenu({ user, photoUrl, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const roleLabel = ROLE_LABEL[user.role] || user.role;
  const img = photoUrl || user.avatarImage;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Profile"
        aria-expanded={open}
        className={`rounded-full ring-2 transition-all ${open ? 'ring-[var(--color-text-main)]' : 'ring-transparent hover:ring-[var(--color-card-border)]'}`}
      >
        <Avatar image={img} initials={user.avatar} alt={user.name} className="w-10 h-10 font-semibold text-[0.85rem]" />
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-64 rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card-bg)] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl z-50">
          <div className="flex items-center gap-3">
            <Avatar image={img} initials={user.avatar} alt={user.name} className="w-12 h-12 font-semibold" />
            <div className="min-w-0">
              <div className="font-semibold text-[var(--color-text-main)] truncate">{user.name}</div>
              <div className="text-xs text-[var(--color-text-muted)] truncate">{user.email}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-[var(--color-card-border)] px-2.5 py-1 text-[0.7rem] font-medium text-[var(--color-text-muted)]">
              {roleLabel}
            </span>
            {user.employeeId && (
              <span className="inline-flex items-center rounded-full border border-[var(--color-card-border)] px-2.5 py-1 text-[0.7rem] font-medium text-[var(--color-text-muted)]">
                ID: {user.employeeId}
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {user.role !== 'lexsysadmin' && (
              <Link
                href="/dashboard/profile"
                onClick={() => setOpen(false)}
                className="btn-outline w-full py-2 text-sm text-center no-underline"
              >
                View profile
              </Link>
            )}
            <button
              onClick={onLogout}
              className="btn-outline w-full py-2 text-sm text-[var(--color-red)] border-[rgba(239,68,68,0.3)] hover:bg-[rgba(239,68,68,0.08)]"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
