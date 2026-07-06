'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const APP_DOWNLOAD_URL = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL;

// Shared stroke-icon props so every glyph reads consistently in the rail.
const ic = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const Icons = {
  dashboard: (<svg {...ic}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>),
  employees: (<svg {...ic}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>),
  teams: (<svg {...ic}><circle cx="12" cy="8" r="3" /><circle cx="5" cy="17" r="2.5" /><circle cx="19" cy="17" r="2.5" /><path d="M12 11v3M9.5 15.5 7 16M14.5 15.5 17 16" /></svg>),
  leave: (<svg {...ic}><path d="M3 9.5 12 4l9 5.5" /><path d="M5 11v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" /><path d="M9 19v-5h6v5" /></svg>),
  assets: (<svg {...ic}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" /></svg>),
  approvals: (<svg {...ic}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>),
  attendance: (<svg {...ic}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  calendar: (<svg {...ic}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>),
  analytics: (<svg {...ic}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>),
  remote: (<svg {...ic}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>),
  recon: (<svg {...ic}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 16 2 2 4-4" /></svg>),
  notices: (<svg {...ic}><path d="M3 11l18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>),
  holidays: (<svg {...ic}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>),
  attenddesk: (<svg {...ic}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18" /></svg>),
  organization: (<svg {...ic}><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" /></svg>),
  download: (<svg {...ic}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>),
  // Application form — used for the "Application" section (request leave & assets).
  application: (<svg {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /><line x1="9" y1="9" x2="11" y2="9" /></svg>),
};

function NavLink({ href, label, icon, exact, onNavigate }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={label}
      aria-label={label}
      className={`grid place-items-center w-11 h-11 rounded-xl transition-all duration-200 ${
        active
          ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-[0_4px_14px_rgba(0,0,0,0.35)]'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-accent-soft)]'
      }`}
    >
      {icon}
    </Link>
  );
}

export default function SidebarNav({ role, isTeamLeader, onNavigate }) {
  const admin = role === 'admin' || role === 'superadmin' || role === 'dev';
  const it = role === 'it_team';
  const emp = role === 'employee';
  // Dev = hybrid: full admin nav (via `admin`) PLUS employee self-service links.
  const dev = role === 'dev';
  return (
    <nav className="flex-1 w-full flex flex-col items-center min-h-0 py-2">
      {/* Scrollable menu items, vertically centered in the rail (my-auto centers
          when there's free space and collapses to 0 when the list overflows, so
          a long admin menu still scrolls from the top). */}
      <div className="flex-1 w-full flex flex-col items-center overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-0">
      <div className="my-auto w-full flex flex-col items-center gap-1.5 py-2">
      {admin && <NavLink href="/dashboard" exact label="Dashboard" icon={Icons.dashboard} onNavigate={onNavigate} />}
      {admin && <NavLink href="/dashboard/people" label="People" icon={Icons.employees} onNavigate={onNavigate} />}
      {(emp || dev) && <NavLink href="/dashboard/my-dashboard" label="Dashboard" icon={Icons.dashboard} onNavigate={onNavigate} />}
      {(emp || dev) && <NavLink href="/dashboard/application" label="Application" icon={Icons.application} onNavigate={onNavigate} />}
      {(emp || dev) && <NavLink href="/dashboard/my-recon" label="Reconciliation" icon={Icons.recon} onNavigate={onNavigate} />}
      {(emp || dev) && isTeamLeader && <NavLink href="/dashboard/team-approvals" label="Team Approvals" icon={Icons.approvals} onNavigate={onNavigate} />}
      {(emp || dev) && isTeamLeader && <NavLink href="/dashboard/team-attendance" label="Team Attendance" icon={Icons.employees} onNavigate={onNavigate} />}
      {/* IT Team role — its own set of sections. */}
      {it && <NavLink href="/dashboard/my-dashboard" label="Dashboard" icon={Icons.dashboard} onNavigate={onNavigate} />}
      {it && <NavLink href="/dashboard/people" label="People" icon={Icons.employees} onNavigate={onNavigate} />}
      {it && <NavLink href="/dashboard/attendance" label="Attendance" icon={Icons.attendance} onNavigate={onNavigate} />}
      {it && <NavLink href="/dashboard/approvals" label="Approvals" icon={Icons.approvals} onNavigate={onNavigate} />}
      {it && <NavLink href="/dashboard/accessories" label="Accessories" icon={Icons.assets} onNavigate={onNavigate} />}
      {it && <NavLink href="/dashboard/tracking" label="Tracking" icon={Icons.recon} onNavigate={onNavigate} />}
      {admin && <NavLink href="/dashboard/attendance" label="Attendance" icon={Icons.attendance} onNavigate={onNavigate} />}
      {(role === 'admin' || role === 'superadmin') && <NavLink href="/dashboard/approvals" label="Approvals" icon={Icons.approvals} onNavigate={onNavigate} />}
      {admin && <NavLink href="/dashboard/noticeboard" label="Notices & Holidays" icon={Icons.notices} onNavigate={onNavigate} />}
      {admin && <NavLink href="/dashboard/attenddesk" label="Settings" icon={Icons.attenddesk} onNavigate={onNavigate} />}
      {admin && <NavLink href="/dashboard/organization" label="Organization" icon={Icons.organization} onNavigate={onNavigate} />}
      </div>
      </div>

      {/* Pinned to the bottom of the rail, below the scrolling menu */}
      {APP_DOWNLOAD_URL && (
        <>
          <div className="w-7 h-px bg-[var(--color-card-border)] mt-2 mb-1 shrink-0" />
          <a
            href={APP_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            download
            onClick={onNavigate}
            title="Download App"
            aria-label="Download App"
            className="grid place-items-center w-11 h-11 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-accent-soft)] transition-all duration-200 shrink-0"
          >
            {Icons.download}
          </a>
        </>
      )}
    </nav>
  );
}
