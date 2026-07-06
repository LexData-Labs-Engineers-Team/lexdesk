'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SidebarNav from '@/components/SidebarNav';
import ProfileMenu from '@/components/ProfileMenu';
import BrandMark from '@/components/BrandMark';

export default function DashboardLayout({ children }) {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [isTeamLeader, setIsTeamLeader] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!storedToken || !storedUser) {
      router.push('/register');
      return;
    }
    try {
      const parsed = JSON.parse(storedUser);
      setUser(parsed);
      // Redirect employee to their allowed landing page
      if (parsed.role === 'employee') {
        const path = window.location.pathname;
        const allowed = ['/dashboard/my-dashboard', '/dashboard/application', '/dashboard/team-approvals', '/dashboard/team-attendance', '/dashboard/profile'];
        if (!allowed.includes(path)) {
          router.replace('/dashboard/my-dashboard');
        }
      }
      // IT Team role — its own allowed sections (Accessories/Tracking added later).
      if (parsed.role === 'it_team') {
        const path = window.location.pathname;
        const allowed = ['/dashboard/my-dashboard', '/dashboard/people', '/dashboard/attendance', '/dashboard/approvals', '/dashboard/accessories', '/dashboard/tracking', '/dashboard/profile'];
        if (!allowed.some((p) => path === p || path.startsWith(p + '/'))) {
          router.replace('/dashboard/my-dashboard');
        }
      }
    } catch {
      router.push('/register');
    }

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      setTheme('light');
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [router]);

  // Refresh the sidebar's copy of the user when the profile page saves changes,
  // and load the AttendDesk profile photo (fresh signed URL) for the sidebar avatar.
  useEffect(() => {
    const loadPhoto = () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      let role;
      try { role = JSON.parse(localStorage.getItem('user') || 'null')?.role; } catch { role = null; }
      if (role === 'lexsysadmin') return; // no org profile for the platform admin
      fetch('/api/me/profile', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.profile) setPhotoUrl(d.profile.photoUrl || null); })
        .catch(() => {});
    };
    const refresh = () => {
      try {
        const stored = localStorage.getItem('user');
        if (stored) setUser(JSON.parse(stored));
      } catch {}
      loadPhoto();
    };
    loadPhoto();
    window.addEventListener('user-updated', refresh);
    return () => window.removeEventListener('user-updated', refresh);
  }, []);

  // Only show "Team Approvals" to employees who actually lead a team.
  useEffect(() => {
    let stored;
    try { stored = JSON.parse(localStorage.getItem('user') || 'null'); } catch { stored = null; }
    if (!stored || (stored.role !== 'employee' && stored.role !== 'dev')) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/teams', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((d) => setIsTeamLeader((d.teams || []).some((t) => String(t.leaderUid) === String(stored.id))))
      .catch(() => {});
  }, []);

  const toggleTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    if (newTheme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  };

  if (!user) return <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">Loading…</div>;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/register');
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[100px_1fr] lg:h-screen lg:overflow-hidden bg-[var(--color-bg)]">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 h-14 bg-[var(--color-bg)]/95 backdrop-blur border-b border-[var(--color-card-border)]">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="w-9 h-9 -ml-1 rounded-lg flex items-center justify-center text-[var(--color-text-main)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-main)] no-underline">
            <BrandMark size={28} />
            TeamOS
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => toggleTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label="Toggle theme"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-black/5 dark:hover:bg-white/5"
            >
              {theme === 'light'
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>}
            </button>
            <ProfileMenu user={user} photoUrl={photoUrl} onLogout={handleLogout} />
          </div>
        </div>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={`fixed inset-y-0 left-0 z-50 w-[84px] flex flex-col items-center bg-[var(--color-card-bg)] border border-[var(--color-card-border)] transform transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:my-3 lg:ml-3 lg:h-[calc(100vh-1.5rem)] lg:rounded-2xl lg:shadow-[0_10px_40px_rgba(0,0,0,0.45)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Link href="/" onClick={() => setSidebarOpen(false)} title="TeamOS home" aria-label="TeamOS home" className="mt-5 mb-4 shrink-0 no-underline">
            <BrandMark size={44} />
          </Link>

          <SidebarNav role={user.role} isTeamLeader={isTeamLeader} onNavigate={() => setSidebarOpen(false)} />
          <div className="mb-3 shrink-0" />
        </aside>

        <main className="flex flex-col flex-1 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.03),transparent_50%)] lg:overflow-hidden relative">

          {/* Desktop controls row — transparent (no navbar bar), but reserves its
              own height (shrink-0) so the scroll region below starts under it and
              cards never slide beneath the theme toggle / profile icon. */}
          <div className="hidden lg:flex shrink-0 justify-end items-center h-[60px] px-8 relative z-50">
            <div className="flex items-center gap-3 pl-3 pr-2 py-2 rounded-full bg-[var(--color-bg)]/75 backdrop-blur-md border border-[var(--color-card-border)] shadow-[0_6px_24px_rgba(0,0,0,0.12)]">
            <button
              onClick={() => toggleTheme(theme === 'light' ? 'dark' : 'light')}
              role="switch"
              aria-checked={theme === 'dark'}
              aria-label="Toggle theme"
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              className="relative w-[76px] h-10 rounded-full p-1.5 flex items-center bg-[var(--color-bg)] border border-[var(--color-card-border)] backdrop-blur-md shadow-[inset_3px_3px_6px_rgba(0,0,0,0.16),inset_-3px_-3px_6px_rgba(255,255,255,0.7)] dark:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-colors"
            >
              {/* faint track icons */}
              <span className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] opacity-50">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              </span>
              <span className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] opacity-50">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              </span>
              {/* sliding knob with the active icon */}
              <span
                className={`absolute top-1.5 left-1.5 w-7 h-7 rounded-full bg-[var(--color-primary)] bg-gradient-to-br from-white/20 to-black/10 text-[var(--color-on-primary)] shadow-[3px_3px_7px_rgba(0,0,0,0.3),-1px_-1px_4px_rgba(255,255,255,0.25)] flex items-center justify-center transition-transform duration-300 ease-out ${
                  theme === 'dark' ? 'translate-x-9' : 'translate-x-0'
                }`}
              >
                {theme === 'light' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                )}
              </span>
            </button>
            <ProfileMenu user={user} photoUrl={photoUrl} onLogout={handleLogout} />
            </div>
          </div>

          <div className="flex-1 lg:overflow-auto p-4 lg:px-8 lg:pb-8 lg:pt-2">
            {children}
          </div>
        </main>
      </div>
  );
}
