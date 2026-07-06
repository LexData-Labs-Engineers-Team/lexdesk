'use client';

// The DOM overlay for the hub. When you dock at a station, its glass panel
// slides in over the (travelled-to) 3D scene. The 3D provides atmosphere + the
// sense of travel; the functions live here in crisp, accessible DOM — including
// a fully working Sign In whose mascot floats free in the space on the left.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RoboAssistant from '@/components/RoboAssistant';
import { getOrCreateWebDeviceId, webDeviceName } from '@/lib/deviceId';
import { FEATURES, APP_DOWNLOAD_URL } from '../content';
import { STATIONS_BY_ID } from './stations';

function EyeToggle({ shown, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition-colors focus:outline-none"
      aria-label={shown ? 'Hide password' : 'Show password'}
    >
      {shown ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" /></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
      )}
    </button>
  );
}

const inputClass =
  'w-full bg-[var(--color-bg)]/70 border border-[var(--color-card-border)] rounded-lg px-4 py-3 text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)] focus:shadow-[0_0_10px_rgba(150,150,150,0.2)] transition-all';
const labelClass = 'block text-sm font-semibold mb-2 text-[var(--color-text-muted)]';

// Shared glass card the panels render into (back button + eyebrow + content).
function HudCard({ station, onBack, children }) {
  return (
    <div className="hub-panel glossy">
      <button type="button" onClick={onBack} className="hub-back" aria-label="Back to hub">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
        Back to hub
      </button>
      <span className="hub-panel__eyebrow">{station?.label}</span>
      {children}
    </div>
  );
}

function SignInPanel({ station, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    focusedField: null,
    isPasswordVisible: false,
    isSubmitting: false,
    hasError: false,
    isSuccess: false,
  });
  const router = useRouter();
  const patch = (p) => setForm((s) => ({ ...s, ...p }));

  const clearErr = () => { if (error) { setError(''); patch({ hasError: false }); } };
  const togglePw = () => { const n = !showPassword; setShowPassword(n); patch({ isPasswordVisible: n }); };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    patch({ isSubmitting: true, hasError: false });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceId: getOrCreateWebDeviceId(), deviceName: webDeviceName() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setDone(true);
      patch({ isSubmitting: false, isSuccess: true });
      setTimeout(() => router.push('/dashboard'), 750);
    } catch (err) {
      setError(err.message);
      patch({ isSubmitting: false, hasError: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Mascot floats free in the space on the left */}
      <div className="hub-mascot" aria-hidden="true">
        <RoboAssistant formState={form} />
      </div>

      <HudCard station={station} onBack={onBack}>
        <h2 className="text-2xl font-bold text-center mb-1 text-[var(--color-text-main)]">Sign In</h2>
        <p className="text-center text-sm text-[var(--color-text-muted)] mb-6">Access your workspace based on your role</p>
        <form onSubmit={handleLogin}>
          {error && <div className="mb-4 text-sm text-[var(--color-red)] text-center">{error}</div>}
          <div className="mb-5">
            <label className={labelClass}>Email Address</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearErr(); }}
              onFocus={() => patch({ focusedField: 'email' })}
              onBlur={() => patch({ focusedField: null })}
              placeholder="you@company.com"
              required
              className={inputClass}
            />
          </div>
          <div className="mb-6 relative">
            <label className={labelClass}>Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearErr(); }}
                onFocus={() => patch({ focusedField: 'password' })}
                onBlur={() => patch({ focusedField: null })}
                placeholder="••••••••"
                required
                className={`${inputClass} pr-10`}
              />
              <EyeToggle shown={showPassword} onToggle={togglePw} />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || done}
            className="w-full btn-primary py-3.5 text-[0.95rem] flex justify-center items-center disabled:opacity-80"
          >
            {done ? 'Welcome!' : loading ? 'Authenticating...' : 'Access Dashboard'}
          </button>
        </form>
      </HudCard>
    </>
  );
}

function JoinPanel({ station, onBack }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  return (
    <HudCard station={station} onBack={onBack}>
      {submitted ? (
        <div className="text-center py-4">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-white/10 text-[var(--color-green)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-[var(--color-text-main)]">Request received</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Thanks{name ? `, ${name.split(' ')[0]}` : ''} — an administrator will set up your account and share your
            login details. Already have access? Travel to <strong className="text-[var(--color-text-main)]">Enter</strong>.
          </p>
        </div>
      ) : (
        <>
          <h2 className="text-2xl font-bold text-center mb-1 text-[var(--color-text-main)]">Request Access</h2>
          <p className="text-center text-sm text-[var(--color-text-muted)] mb-6">Tell us who you are — your admin does the rest</p>
          <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}>
            <div className="mb-5">
              <label className={labelClass}>Full Name</label>
              <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" required className={inputClass} />
            </div>
            <div className="mb-6">
              <label className={labelClass}>Work Email</label>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required className={inputClass} />
            </div>
            <button type="submit" className="w-full btn-primary py-3.5 text-[0.95rem] flex justify-center items-center">Request Access</button>
          </form>
        </>
      )}
    </HudCard>
  );
}

function FeaturesPanel({ station, onBack }) {
  return (
    <HudCard station={station} onBack={onBack}>
      <h2 className="text-2xl font-bold text-center mb-1 text-[var(--color-text-main)]">What TeamOS does</h2>
      <p className="text-center text-sm text-[var(--color-text-muted)] mb-6">One platform for the whole employee lifecycle</p>
      <ul className="grid gap-3 list-none p-0 m-0">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex items-start gap-3 rounded-xl border border-[var(--color-card-border)] bg-white/[0.03] p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-[var(--color-purple)]">{f.icon}</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-main)]">{f.title}</h3>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </HudCard>
  );
}

function AppPanel({ station, onBack }) {
  return (
    <HudCard station={station} onBack={onBack}>
      <div className="text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-[var(--color-text-main)]">
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M12 18h.01" /></svg>
        </div>
        <h2 className="text-2xl font-bold mb-1 text-[var(--color-text-main)]">Get the mobile app</h2>
        <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed">
          Verified check-in from anywhere — WiFi, GPS geofence, rotating QR, and face verification, right from your phone.
        </p>
        {APP_DOWNLOAD_URL ? (
          <a href={APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" download className="btn-primary inline-flex px-7 py-3.5 text-[0.95rem] no-underline">
            Download the app
          </a>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">Download link coming soon — ask your admin for the APK.</p>
        )}
      </div>
    </HudCard>
  );
}

// Count a number up from 0 on mount — a little life for the live dashboard.
function useCountUp(target, duration = 1100) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setVal(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function Stat({ label, value, suffix = '' }) {
  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-white/[0.03] p-3 text-center">
      <div className="text-2xl font-extrabold text-[var(--color-text-main)]">{value}{suffix}</div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</div>
    </div>
  );
}

const WEEK = [62, 78, 71, 85, 90, 44, 30];
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function PulsePanel({ station, onBack }) {
  const [ready, setReady] = useState(false);
  const present = useCountUp(142);
  const leave = useCountUp(8);
  const remote = useCountUp(23);
  const avg = useCountUp(7.8);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <HudCard station={station} onBack={onBack}>
      <h2 className="text-2xl font-bold text-center mb-1 text-[var(--color-text-main)]">Live Pulse</h2>
      <p className="text-center text-sm text-[var(--color-text-muted)] mb-6">A glance at today across your org</p>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Stat label="Present" value={Math.round(present)} />
        <Stat label="On leave" value={Math.round(leave)} />
        <Stat label="Remote" value={Math.round(remote)} />
        <Stat label="Avg hours" value={avg.toFixed(1)} suffix="h" />
      </div>
      <div className="rounded-xl border border-[var(--color-card-border)] bg-white/[0.03] p-4">
        <div className="flex items-end justify-between gap-2 h-24">
          {WEEK.map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
              <div
                className="w-full rounded-t bg-gradient-to-t from-white/25 to-white/80"
                style={{ height: ready ? `${h}%` : '0%', transition: `height 0.7s cubic-bezier(0.22,1,0.36,1) ${i * 60}ms` }}
              />
              <span className="text-[10px] text-[var(--color-text-muted)]">{DAYS[i]}</span>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-[var(--color-text-muted)] mt-3">Attendance this week · sample</p>
      </div>
    </HudCard>
  );
}

const PANELS = { signin: SignInPanel, join: JoinPanel, features: FeaturesPanel, pulse: PulsePanel, app: AppPanel };

export default function HubHud({ selected, onBack }) {
  if (!selected) return null;
  const station = STATIONS_BY_ID[selected];
  const Panel = PANELS[selected];
  if (!Panel) return null;

  return (
    <div className="hub-hud" key={selected}>
      <Panel station={station} onBack={onBack} />
    </div>
  );
}
