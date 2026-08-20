'use client';
// HR workspace shell — its own module (mirrors ReceptionShell / FinanceShell).
// An `hr`-role user logs in and lands here; admins can also reach it.

import {
  Users,
  Mail,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  IdCard,
  X,
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DrawerMenu, type DrawerMenuItem } from '@/components/sales-v2/ui/DrawerMenu';
import { RoleBadge } from '@/components/sales-v2/ui/RoleBadge';
import { ThemeToggle } from './ThemeToggle';
import { NotificationsBell } from './NotificationsBell';
import { logout as sessionLogout, useSession } from '@/lib/session';

export interface HrUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: string;
  roles: string[];
  permissions: string[];
}

interface HrSessionContextValue { user: HrUser; logout: () => void }
const HrSessionContext = createContext<HrSessionContextValue | null>(null);
export function useHrSession(): HrSessionContextValue {
  const ctx = useContext(HrSessionContext);
  if (!ctx) throw new Error('useHrSession must be used inside <HrShell>');
  return ctx;
}

const HR_ROLES = new Set(['hr', 'super_admin', 'admin']);

const NAV: DrawerMenuItem[] = [
  { label: 'Team', href: '/hr', icon: Users, caption: 'Directory & onboarding' },
  { label: 'Email Accounts', href: '/hr/emails', icon: Mail, caption: 'Business email provisioning' },
];

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith('/hr/emails')) return { title: 'Email Accounts', subtitle: 'Business email status & provisioning across the team' };
  return { title: 'Team', subtitle: 'Onboard staff, manage the directory, offboard' };
}

export function HrShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railed, setRailed] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem('hr.sidebar.railed') === '1') setRailed(true); } catch { /* ignore */ }
  }, []);
  const toggleRail = () => setRailed((v) => {
    const next = !v;
    try { localStorage.setItem('hr.sidebar.railed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  useEffect(() => {
    if (session.status === 'unauthed') { router.replace('/login'); return; }
    if (session.status === 'authed' && !session.user.roles.some((r) => HR_ROLES.has(r))) {
      router.replace('/login');
    }
  }, [session, router]);

  const sessionValue = useMemo<HrSessionContextValue | null>(() => {
    if (session.status !== 'authed') return null;
    const handle = session.user.email.split('@')[0] ?? 'hr';
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: handle,
        initials: handle.slice(0, 2).toUpperCase(),
        role: session.user.roles[0] ?? 'hr',
        roles: session.user.roles,
        permissions: session.user.permissions,
      },
      logout: () => { sessionLogout(); router.replace('/login'); },
    };
  }, [session, router]);

  if (session.status === 'loading') {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading HR…</div>;
  }
  if (session.status !== 'authed' || !sessionValue) return null;

  const { user, logout } = sessionValue;
  const { title, subtitle } = getPageTitle(pathname);

  return (
    <HrSessionContext.Provider value={sessionValue}>
      <div className={`sos-shell ${railed ? 'is-railed' : ''}`}>
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo"><IdCard size={18} /></div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tashfeen</div>
              <div className="sos-sidebar__brand-tagline">HR</div>
            </div>
            <button type="button" className="sos-rail-toggle" onClick={toggleRail}
              aria-label={railed ? 'Expand sidebar' : 'Collapse sidebar'} title={railed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {railed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="sos-mobile-close"
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '6px' }}>
              <X size={16} />
            </button>
          </div>

          <div className="sos-sidebar__nav sos-scroll">
            <div className="sos-nav-section">Workspace</div>
            <DrawerMenu items={NAV} onNavigate={() => setMobileOpen(false)} />
          </div>

          <div className="sos-sidebar__user">
            <div className="sos-sidebar__user-avatar">{user.initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: 'var(--sos-sidebar-text-strong)', fontSize: '13px', fontWeight: 600 }}>{user.name}</div>
              <div style={{ color: 'var(--sos-sidebar-text-muted)', fontSize: '11px' }}>{user.role}</div>
            </div>
            <button type="button" onClick={logout} aria-label="Logout"
              style={{ background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '8px', borderRadius: '10px' }}>
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        {mobileOpen && (
          <div aria-hidden="true" onClick={() => setMobileOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }} />
        )}

        <div className="sos-main">
          <header className="sos-topbar">
            <button type="button" aria-label="Open menu" onClick={() => setMobileOpen(true)} className="sos-topbar__mobile-toggle"
              style={{ background: 'transparent', border: 'none', color: 'var(--sos-topbar-icon)', cursor: 'pointer', padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center' }}>
              <Menu size={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sos-topbar__title">{title}</div>
              {subtitle ? <div className="sos-topbar__subtitle">{subtitle}</div> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ThemeToggle />
              <NotificationsBell iconSize={16} />
              <span className="sos-topbar__optional"><RoleBadge role="HR" /></span>
            </div>
          </header>
          <main className="sos-page-content sos-scroll">{children}</main>
        </div>
      </div>
    </HrSessionContext.Provider>
  );
}
