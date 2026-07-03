'use client';
// Reception / Front-Desk workspace shell — mirrors ProcessingShell / FinanceShell.
// A reception-role user logs in and lands here; the front-desk console is the home.

import {
  BarChart3,
  ClipboardList,
  DoorOpen,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DrawerMenu, type DrawerMenuItem } from '@/components/sales-v2/ui/DrawerMenu';
import { RoleBadge } from '@/components/sales-v2/ui/RoleBadge';
import { ThemeToggle } from './ThemeToggle';
import { NotificationsBell } from './NotificationsBell';
import { logout as sessionLogout, useSession } from '@/lib/session';

export interface ReceptionUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: string;
  roles: string[];
  permissions: string[];
}

interface ReceptionSessionContextValue {
  user: ReceptionUser;
  logout: () => void;
}

const ReceptionSessionContext = createContext<ReceptionSessionContextValue | null>(null);

export function useReceptionSession(): ReceptionSessionContextValue {
  const ctx = useContext(ReceptionSessionContext);
  if (!ctx) {
    throw new Error('useReceptionSession must be used inside <ReceptionShell>');
  }
  return ctx;
}

// Admins can reach the front desk for oversight; the dedicated reception role is
// the primary occupant.
const RECEPTION_ROLES = new Set(['reception', 'super_admin', 'admin']);

const NAV: DrawerMenuItem[] = [
  { label: 'Front Desk', href: '/reception', icon: DoorOpen, caption: 'Live lobby & check-in' },
  { label: 'Visitors', href: '/reception/visitors', icon: ClipboardList, caption: 'Full visit log' },
  { label: 'Payments', href: '/reception/payments', icon: Wallet, caption: 'Consultation fees — cash & bank' },
  { label: 'Reports', href: '/reception/reports', icon: BarChart3, caption: 'Footfall, conversion & revenue' },
];

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/reception/visitors') {
    return { title: 'Visitors', subtitle: 'The full visit log — search, filter and history' };
  }
  if (pathname === '/reception/payments') {
    return { title: 'Payments', subtitle: 'Consultation fees — cash, bank transfer and pending verification' };
  }
  if (pathname === '/reception/reports') {
    return { title: 'Reports', subtitle: 'Footfall, conversion, consultation revenue and no-shows' };
  }
  if (pathname === '/reception') {
    return { title: 'Front Desk', subtitle: 'Live lobby — check visitors in, out and no-show' };
  }
  return { title: 'Reception', subtitle: '' };
}

export function ReceptionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railed, setRailed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('reception.sidebar.railed') === '1') setRailed(true);
    } catch {
      /* localStorage unavailable — default expanded */
    }
  }, []);
  const toggleRail = () => {
    setRailed((v) => {
      const next = !v;
      try {
        localStorage.setItem('reception.sidebar.railed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (session.status === 'unauthed') {
      router.replace('/login');
      return;
    }
    if (session.status === 'authed') {
      const hasAccess = session.user.roles.some((r) => RECEPTION_ROLES.has(r));
      if (!hasAccess) router.replace('/login');
    }
  }, [session, router]);

  const sessionValue = useMemo<ReceptionSessionContextValue | null>(() => {
    if (session.status !== 'authed') return null;
    const emailHandle = session.user.email.split('@')[0] ?? 'reception';
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: emailHandle,
        initials: emailHandle.slice(0, 2).toUpperCase(),
        role: session.user.roles[0] ?? 'reception',
        roles: session.user.roles,
        permissions: session.user.permissions,
      },
      logout: () => {
        sessionLogout();
        router.replace('/login');
      },
    };
  }, [session, router]);

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        Loading front desk…
      </div>
    );
  }
  if (session.status !== 'authed' || !sessionValue) return null;

  const user = sessionValue.user;
  const logout = sessionValue.logout;
  const { title, subtitle } = getPageTitle(pathname);

  return (
    <ReceptionSessionContext.Provider value={sessionValue}>
      <div className={`sos-shell ${railed ? 'is-railed' : ''}`}>
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Sparkles size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tashfeen</div>
              <div className="sos-sidebar__brand-tagline">Reception OS</div>
            </div>
            <button
              type="button"
              className="sos-rail-toggle"
              onClick={toggleRail}
              aria-label={railed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={railed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {railed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="sos-mobile-close"
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '6px' }}
            >
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
            <button type="button" onClick={logout} aria-label="Logout" style={{ background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '8px', borderRadius: '10px' }}>
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        {/* ── Mobile overlay ───────────────────────────────────────────── */}
        {mobileOpen && (
          <div
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
          />
        )}

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="sos-main">
          <header className="sos-topbar">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="sos-topbar__mobile-toggle"
              style={{ background: 'transparent', border: 'none', color: 'var(--sos-topbar-icon)', cursor: 'pointer', padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center' }}
            >
              <Menu size={18} />
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sos-topbar__title">{title}</div>
              {subtitle ? <div className="sos-topbar__subtitle">{subtitle}</div> : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ThemeToggle />
              <NotificationsBell iconSize={16} />
              <span className="sos-topbar__optional">
                <RoleBadge role="Reception" />
              </span>
            </div>
          </header>

          <main className="sos-page-content sos-scroll">{children}</main>
        </div>
      </div>
    </ReceptionSessionContext.Provider>
  );
}
