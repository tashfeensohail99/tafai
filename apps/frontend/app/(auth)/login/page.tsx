'use client';

import { useState, type FormEvent } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Users,
  Wallet,
  ClipboardList,
  User,
} from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { destinationForUser, login } from '@/lib/session';

type Role = 'ADMIN' | 'SALES' | 'FINANCE' | 'PROCESSING' | 'CLIENT';

const ROLES: Array<{
  key: Role;
  label: string;
  caption: string;
  Icon: typeof Users;
  accent: string;
}> = [
  { key: 'SALES', label: 'Sales', caption: 'Manage leads, follow-ups, and handovers', Icon: Users, accent: '#4f46e5' },
  { key: 'FINANCE', label: 'Finance', caption: 'Verify payments and review receipts', Icon: Wallet, accent: '#10b981' },
  { key: 'PROCESSING', label: 'Processing', caption: 'Handle case documents and submissions', Icon: ClipboardList, accent: '#0ea5e9' },
  { key: 'ADMIN', label: 'Admin', caption: 'System control & assignments', Icon: ShieldCheck, accent: '#ef4444' },
  { key: 'CLIENT', label: 'Client', caption: 'Track your case, upload documents', Icon: User, accent: '#8b5cf6' },
];

// Staging convenience: clicking a role tile auto-fills these. They MUST match
// rows seeded in prisma/seed.ts. Real login still goes through /auth/login.
const TEST_CREDENTIALS: Record<Role, { email: string; password: string; name: string }> = {
  SALES:      { email: 'awais.q@tafsheen.com',  password: 'sales123',     name: 'Awais Q.' },
  FINANCE:    { email: 'hassan.f@tafsheen.com', password: 'finance123',   name: 'Hassan F.' },
  PROCESSING: { email: 'sara.p@tafsheen.com',   password: 'processing123', name: 'Sara P.' },
  ADMIN:      { email: 'admin@tafsheen.com',    password: 'admin123',     name: 'Admin' },
  CLIENT:     { email: 'ali.hassan@example.com', password: 'client123',   name: 'Ali Hassan' },
};

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('SALES');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-prefill credentials when role changes (staging only)
  function pickRole(next: Role) {
    setRole(next);
    setEmail(TEST_CREDENTIALS[next].email);
    setPassword(TEST_CREDENTIALS[next].password);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      router.replace(destinationForUser(user) as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: 'var(--sos-bg-app)',
        color: 'var(--sos-text-primary)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.05fr)',
      }}
    >
      {/* Left — branding */}
      <aside
        className="relative hidden lg:flex"
        style={{
          background:
            'radial-gradient(circle at 18% 20%, rgb(129 140 248 / 0.45), transparent 35%), radial-gradient(circle at 80% 80%, rgb(59 130 246 / 0.35), transparent 40%), linear-gradient(160deg, #0d1226 0%, #11173a 60%, #1e1b4b 100%)',
          color: '#fff',
          padding: 48,
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #4f46e5 0%, #818cf8 100%)',
              boxShadow: '0 12px 28px rgb(79 70 229 / 0.4)',
            }}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>Tafsheen</div>
            <div style={{ fontSize: 11, color: 'rgb(255 255 255 / 0.55)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              Sales Operating System
            </div>
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em', maxWidth: 460 }}>
            One workspace, from first touch to finance handover.
          </h2>
          <p style={{ marginTop: 18, color: 'rgb(255 255 255 / 0.7)', fontSize: 15, lineHeight: 1.6, maxWidth: 480 }}>
            Tafsheen helps your sales team move every assigned lead through follow-ups, appointments, and payment hand-offs without losing track.
          </p>

          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
            {[
              { title: 'Auto-routed leads', body: 'CRM and walk-in leads land in the right rep’s queue.' },
              { title: 'Smart follow-ups', body: 'Never miss an SLA. Calls, WhatsApp, and reminders.' },
              { title: 'Clean handover', body: 'Send finance a complete receipt + sales note in one click.' },
            ].map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background: 'rgb(255 255 255 / 0.05)', border: '1px solid rgb(255 255 255 / 0.08)' }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    marginTop: 7,
                    background: '#a5b4fc',
                    boxShadow: '0 0 10px rgb(165 180 252 / 0.6)',
                  }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                  <div style={{ color: 'rgb(255 255 255 / 0.65)', fontSize: 13, marginTop: 2 }}>{item.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'rgb(255 255 255 / 0.5)' }}>
          © {new Date().getFullYear()} Tafsheen — Sales Workspace v2
        </div>
      </aside>

      {/* Right — login card */}
      <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2 lg:hidden">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #4f46e5 0%, #818cf8 100%)',
                  color: '#fff',
                }}
              >
                <Sparkles className="h-4 w-4" />
              </div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Tafsheen</span>
            </div>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>

          <div className="sos-eyebrow">Welcome back</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--sos-text-primary)', marginTop: 4 }}>
            Sign in to continue
          </h1>
          <p style={{ color: 'var(--sos-text-muted)', fontSize: 14, marginTop: 6 }}>
            Choose your role and use your work credentials.
          </p>

          {/* Staging credentials card — picks role auto-fills email + password */}
          <div
            style={{
              marginTop: 18,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--sos-brand-primary-soft)',
              border: '1px solid var(--sos-brand-primary-border)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <Sparkles
              size={14}
              style={{
                color: 'var(--sos-brand-primary-strong)',
                marginTop: 3,
                flexShrink: 0,
              }}
            />
            <div style={{ minWidth: 0, fontSize: 12, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                Staging — test credentials
              </div>
              <div style={{ color: 'var(--sos-text-secondary)', marginTop: 4 }}>
                Click a role below and the email + password fill in for you.
                Or use:
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  color: 'var(--sos-text-secondary)',
                  display: 'grid',
                  gap: 2,
                }}
              >
                <div>
                  <strong style={{ color: 'var(--sos-text-primary)' }}>Sales:</strong>{' '}
                  awais.q@tafsheen.com / sales123
                </div>
                <div>
                  <strong style={{ color: 'var(--sos-text-primary)' }}>Finance:</strong>{' '}
                  hassan.f@tafsheen.com / finance123
                </div>
                <div>
                  <strong style={{ color: 'var(--sos-text-primary)' }}>Processing:</strong>{' '}
                  sara.p@tafsheen.com / processing123
                </div>
                <div>
                  <strong style={{ color: 'var(--sos-text-primary)' }}>Admin:</strong>{' '}
                  admin@tafsheen.com / admin123
                </div>
                <div>
                  <strong style={{ color: 'var(--sos-text-primary)' }}>Client:</strong>{' '}
                  ali.hassan@example.com / client123
                </div>
              </div>
            </div>
          </div>

          {/* Role grid */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            {ROLES.map(({ key, label, caption, Icon, accent }) => {
              const active = role === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickRole(key)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 18,
                    border: active
                      ? '1.5px solid var(--sos-brand-primary)'
                      : '1.5px solid var(--sos-border)',
                    borderRadius: 14,
                    background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                    boxShadow: active ? '0 0 0 3px var(--sos-brand-primary-soft)' : 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    transition: 'all 160ms ease',
                    fontFamily: 'inherit',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: `${accent}1f`,
                        color: accent,
                      }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--sos-text-primary)' }}>{label}</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--sos-text-muted)', lineHeight: 1.4 }}>{caption}</p>
                </button>
              );
            })}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
            {error ? (
              <div role="alert" className="sos-banner sos-banner--danger">
                {error}
              </div>
            ) : null}

            <div>
              <label htmlFor="email" className="sos-label">
                Email or phone
              </label>
              <input
                id="email"
                type="text"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="sos-input"
                placeholder="you@tafsheen.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="sos-label">
                  Password
                </label>
                <button
                  type="button"
                  style={{
                    padding: '2px 4px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--sos-brand-primary-strong)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Forgot?
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="sos-input"
                  placeholder="••••••••"
                  style={{ paddingRight: 42 }}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--sos-text-faint)',
                    padding: 4,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="mt-1 flex items-center gap-2 text-[13px]" style={{ color: 'var(--sos-text-muted)' }}>
              <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" />
              Keep me signed in on this device
            </label>

            <button
              type="submit"
              disabled={loading}
              className="sos-btn sos-btn--primary mt-1"
              style={{ width: '100%', padding: '12px 16px' }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? 'Signing in…' : `Continue as ${ROLES.find((r) => r.key === role)?.label}`}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </form>

          <p style={{ marginTop: 22, fontSize: 12, color: 'var(--sos-text-faint)', textAlign: 'center' }}>
            Tafsheen is a closed workspace. Contact your administrator if you need access.
          </p>
        </div>
      </section>
    </div>
  );
}
