'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthDecor } from '@/components/authDecor';
import RoboAssistant from '@/components/RoboAssistant';
import { getOrCreateWebDeviceId, webDeviceName } from '@/lib/deviceId';

const APP_DOWNLOAD_URL = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL;

// Shape the RoboAssistant reads. The child forms patch this via `onState` so the
// bot above the card reacts to focus, password reveal, submit, and success.
const INITIAL_FORM_STATE = {
  focusedField: null,
  isPasswordVisible: false,
  isSubmitting: false,
  hasError: false,
  isSuccess: false,
};

function EyeButton({ shown, onToggle }) {
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
  'w-full bg-[var(--color-bg)] border border-[var(--color-card-border)] rounded-lg px-4 py-3 text-[var(--color-text-main)] focus:outline-none focus:border-[var(--color-purple)] focus:shadow-[0_0_10px_rgba(150,150,150,0.2)] transition-all';
const labelClass = 'block text-sm font-semibold mb-2 text-[var(--color-text-muted)]';

function SignInForm({ onState }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  // Clearing the error as soon as the user edits lets the bot recover from its
  // frown instead of sulking until the next submit.
  const clearErrorOnEdit = () => {
    if (error) {
      setError('');
      onState({ hasError: false });
    }
  };

  const togglePassword = () => {
    const next = !showPassword;
    setShowPassword(next);
    onState({ isPasswordVisible: next });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    onState({ isSubmitting: true, hasError: false });

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

      // Let the bot celebrate for a beat before we navigate away.
      setDone(true);
      onState({ isSubmitting: false, isSuccess: true });
      setTimeout(() => router.push('/dashboard'), 750);
    } catch (err) {
      setError(err.message);
      onState({ isSubmitting: false, hasError: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleLogin}>
      {error && <div className="mb-4 text-sm text-[var(--color-red)] text-center">{error}</div>}

      <div className="mb-6">
        <label className={labelClass}>Email Address</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearErrorOnEdit();
          }}
          onFocus={() => onState({ focusedField: 'email' })}
          onBlur={() => onState({ focusedField: null })}
          placeholder="you@company.com"
          required
          className={inputClass}
        />
      </div>

      <div className="mb-8 relative">
        <label className={labelClass}>Password</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearErrorOnEdit();
            }}
            onFocus={() => onState({ focusedField: 'password' })}
            onBlur={() => onState({ focusedField: null })}
            placeholder="••••••••"
            required
            className={`${inputClass} pr-10`}
          />
          <EyeButton shown={showPassword} onToggle={togglePassword} />
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
  );
}

export default function Register() {
  const [formState, setFormState] = useState(INITIAL_FORM_STATE);

  const updateFormState = useCallback((patch) => {
    setFormState((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <div className="relative overflow-hidden flex flex-col min-h-screen bg-[var(--color-bg)]">
      <AuthDecor />

      {/* Navbar — TeamOS branding pinned to the top-left corner */}
      <nav className="relative z-20 px-4 sm:px-8 md:px-16 py-5 max-w-[1400px] mx-auto w-full">
        <Link href="/" className="inline-flex items-center gap-3 no-underline">
          <div className="w-10 h-10 rounded-xl bg-black border border-white/20 bg-gradient-to-br from-white/15 to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_rgba(0,0,0,0.25)] flex items-center justify-center text-white font-bold">T</div>
          <span className="text-xl font-bold tracking-tight text-[var(--color-text-main)]">TeamOS</span>
        </Link>
      </nav>

      <div className="relative flex-1 flex flex-col md:flex-row items-center md:justify-between px-4 sm:px-8 md:px-16 max-w-[1400px] mx-auto w-full gap-8 md:gap-16 py-10 md:py-0">
        {/* Bot side — moved left and enlarged */}
        <div className="flex-1 flex flex-col items-center md:items-start">
          <RoboAssistant
            formState={formState}
            className="w-[280px] h-[320px] sm:w-[340px] sm:h-[390px]"
          />
        </div>

        {/* Auth column — sign in only */}
        <div className="w-full sm:max-w-[450px] flex flex-col items-center">
          <div className="w-full p-6 sm:p-10 bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-2xl backdrop-blur-xl shadow-2xl relative z-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-2 text-[var(--color-text-main)]">Sign In</h2>
              <p className="text-[var(--color-text-muted)] text-[0.95rem]">
                Access your workspace based on your role
              </p>
            </div>

            <SignInForm onState={updateFormState} />

            {APP_DOWNLOAD_URL && (
              <div className="mt-6 pt-5 border-t border-[var(--color-card-border)] text-center text-sm text-[var(--color-text-muted)]">
                Use the mobile app to check in ·{' '}
                <a href={APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" download className="text-[var(--color-purple)] hover:underline font-medium">
                  Download the app
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
