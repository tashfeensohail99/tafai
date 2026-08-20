'use client';

// Judicial Review workspace shell — mirrors ProcessingShell.
// Login-gated (same STAFF_ROLES as the old /jr prototype), a permission-gated
// sidebar, and a topbar with a "Back to workspace" link. The shell only gates +
// frames; each page reads useJrSession() for the caller's permissions.

import {
  ClipboardList,
  Gavel,
  LogOut,
  Menu,
  Scale,
  Sparkles,
  CalendarClock,
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
import { destinationForUser, logout as sessionLogout, useSession } from '@/lib/session';

// Staff roles allowed into the JR console. Matches the old prototype's
// STAFF_ROLES exactly (clients excluded). Backend endpoints are the real
// authority; this gate just keeps non-staff out of the shell entirely.
const STAFF_ROLES = new Set<string>([
  'super_admin',
  'admin',
  'jr',
  'jr_head',
  'jr_associate',
  'sales',
  'finance',
  'processing',
  'processing_manager',
  'documentation',
  'reception',
  'marketing',
]);

export interface JrUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: string;
  roles: string[];
  permissions: string[];
}

interface JrSessionContextValue {
  user: JrUser;
  /** 'head' when the caller can view every matter (jr.matter.view_all), else 'assoc'. */
  mode: 'head' | 'assoc';
  logout: () => void;
}

const JrSessionContext = createContext<JrSessionContextValue | null>(null);

export function useJrSession(): JrSessionContextValue {
  const ctx = useContext(JrSessionContext);
  if (!ctx) {
    throw new Error('useJrSession must be used inside <JrShell>');
  }
  return ctx;
}

function buildJrNav(permissions: string[]): DrawerMenuItem[] {
  const canViewMatters =
    permissions.includes('jr.matter.view_assigned') ||
    permissions.includes('jr.matter.view_all');
  const canViewAll = permissions.includes('jr.matter.view_all');

  const items: DrawerMenuItem[] = [
    { label: 'Matters', href: '/jr', icon: Scale, caption: 'Judicial review caseload' },
  ];
  if (canViewMatters) {
    items.push({
      label: 'Deadline Board',
      href: '/jr/board',
      icon: CalendarClock,
      caption: 'Pending fatal + procedural dates',
    });
  }
  if (canViewAll) {
    items.push({
      label: 'Counsel Queue',
      href: '/jr/counsel-queue',
      icon: Gavel,
      caption: 'Artifacts awaiting counsel review',
    });
  }
  return items;
}

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/jr') return { title: 'Judicial Review', subtitle: 'Federal Court JR caseload' };
  if (pathname === '/jr/board') return { title: 'Deadline Board', subtitle: 'Pending fatal & procedural deadlines' };
  if (pathname === '/jr/counsel-queue') return { title: 'Counsel Queue', subtitle: 'Artifacts awaiting counsel review' };
  if (pathname.startsWith('/jr/matters/')) return { title: 'Matter', subtitle: 'Judicial review matter detail' };
  return { title: 'Judicial Review', subtitle: '' };
}

export function JrShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (session.status === 'unauthed') {
      router.replace('/login');
      return;
    }
    if (session.status === 'authed') {
      const ok = session.user.roles.some((r) => STAFF_ROLES.has(r));
      if (!ok) router.replace(destinationForUser(session.user));
    }
  }, [session, router]);

  const sessionValue = useMemo<JrSessionContextValue | null>(() => {
    if (session.status !== 'authed') return null;
    const emailHandle = session.user.email.split('@')[0] ?? 'user';
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: emailHandle,
        initials: emailHandle.slice(0, 2).toUpperCase(),
        role: session.user.roles[0] ?? 'JR',
        roles: session.user.roles,
        permissions: session.user.permissions,
      },
      mode: session.user.permissions.includes('jr.matter.view_all') ? 'head' : 'assoc',
      logout: () => {
        sessionLogout();
        router.replace('/login');
      },
    };
  }, [session, router]);

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        Loading workspace…
      </div>
    );
  }
  if (session.status !== 'authed' || !sessionValue) return null;
  // Bounce guard: authed but not staff — the effect above is redirecting.
  if (!sessionValue.user.roles.some((r) => STAFF_ROLES.has(r))) return null;

  const user = sessionValue.user;
  const logout = sessionValue.logout;
  const { title, subtitle } = getPageTitle(pathname);
  const navItems = buildJrNav(user.permissions);
  const workspaceHref = destinationForUser({
    id: user.id,
    email: user.email,
    roles: user.roles,
    permissions: user.permissions,
  });

  return (
    <JrSessionContext.Provider value={sessionValue}>
      <div className="sos-shell">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Sparkles size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tashfeen</div>
              <div className="sos-sidebar__brand-tagline">Judicial Review</div>
            </div>
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
            <DrawerMenu items={navItems} onNavigate={() => setMobileOpen(false)} />

            <div className="sos-nav-section" style={{ marginTop: '12px' }}>Desk</div>
            <div className="sos-sidebar__panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-sidebar-text-strong)' }}>
                <ClipboardList size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />
                {sessionValue.mode === 'head' ? 'Head console' : 'Associate workspace'}
              </div>
              <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--sos-sidebar-text-muted)', lineHeight: 1.5 }}>
                {sessionValue.mode === 'head'
                  ? 'You can see every matter and assign associates.'
                  : 'You see the matters assigned to you.'}
              </div>
            </div>
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
              <a
                href={workspaceHref}
                style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                Back to workspace
              </a>
              <ThemeToggle />
              <NotificationsBell iconSize={16} />
              <span className="sos-topbar__optional">
                <RoleBadge role="Judicial Review" />
              </span>
            </div>
          </header>

          <main className="sos-page-content sos-scroll">
            {children}
          </main>
        </div>
      </div>
    </JrSessionContext.Provider>
  );
}
