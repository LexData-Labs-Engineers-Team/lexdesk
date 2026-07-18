'use client';

import Avatar from '@/components/Avatar';

const initials = (name) =>
  (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// One member's profile card — shared by the team-lead Team Attendance view and
// the People → Employees grid.
//   onEdit(m)  (optional) renders the ⋮ action (opens an edit modal).
//   onOpen(m)  (optional) makes the whole card clickable (e.g. open the member's
//              detail page). The two are independent: pass either, both, or none.
export default function MemberCard({ m, onEdit, onOpen }) {
  const clickable = typeof onOpen === 'function';
  return (
    <div
      className={`card relative flex flex-col items-center text-center !p-0 overflow-hidden${
        clickable ? ' cursor-pointer hover:border-[var(--color-purple)] transition-all' : ''
      }`}
      onClick={clickable ? () => onOpen(m) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(m); } }
          : undefined
      }
    >
      {/* ⋮ menu — edit this member's profile */}
      {onEdit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(m); }}
          className="absolute top-2 right-2 p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-accent-soft)] transition-colors"
          title="Edit profile"
          aria-label={`Edit ${m.name || 'member'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
      )}

      {/* Avatar + name + designation */}
      <div className="flex flex-col items-center pt-7 pb-4 px-4">
        <Avatar image={m.photoUrl} initials={initials(m.name)} alt={m.name} className="w-16 h-16 text-base font-bold ring-4 ring-[var(--color-card-border)]" />
        <h3 className="mt-3 text-sm font-semibold text-[var(--color-text-main)]">{m.name || '—'}</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{m.designation || m.teamName || 'Team member'}</p>
      </div>

      {/* Contact */}
      <div className="w-full px-5 py-3 flex flex-col gap-2 text-xs border-t border-[var(--color-card-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
          <span className="truncate text-[var(--color-text-main)]">{m.email || '—'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
          <span className="truncate text-[var(--color-text-main)]">{m.contactNumber || '—'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <svg className="text-[var(--color-text-muted)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8" /></svg>
          <span className="truncate text-[var(--color-text-main)]">{fmtDate(m.birthDate)}</span>
        </div>
      </div>

      {/* Employee ID / department / joining — tinted footer */}
      <div className="w-full px-5 py-4 flex flex-col gap-2 text-xs" style={{ background: 'var(--color-accent-soft)' }}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Employee ID</span>
          <span className="font-semibold text-[var(--color-text-main)] font-mono truncate">{m.employeeId || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Department</span>
          <span className="font-semibold text-[var(--color-text-main)] truncate">{m.department || m.teamName || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Date of Joining</span>
          <span className="font-semibold text-[var(--color-text-main)]">{fmtDate(m.joiningDate)}</span>
        </div>
      </div>
    </div>
  );
}
