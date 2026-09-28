'use client';

import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Menu,
  User,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  CLIENT_STAGE_LABEL,
  CLIENT_STAGE_TONE,
  getMyCases,
  type PortalCaseSummary,
} from '@/lib/portal';
import { logout, useSession, type SessionUser } from '@/lib/session';

// ---------- Session context exposed to portal pages -----------------------

interface ClientSessionShape {
  user: SessionUser;
  cases: PortalCaseSummary[];
  activeCase: PortalCaseSummary | null;
  refreshCases: () => Promise<void>;
}

const ClientSessionContext = createContext<ClientSessionShape | null>(null);

export function useClientSession(): ClientSessionShape {
  const ctx = useContext(ClientSessionContext);
  if (!ctx) {
    throw new Error('useClientSession must be used inside <ClientPortalShell>');
  }
  return ctx;
}

// ---------- Sidebar -------------------------------------------------------

function PortalSidebar({
  open,
  onClose,
  user,
  activeCase,
}: {
  open: boolean;
  onClose: () => void;
  user: SessionUser;
  activeCase: PortalCaseSummary | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = useMemo(
    () => [
      { label: 'My Case', href: '/portal/case', icon: LayoutDashboard, caption: 'Overview and status' },
      {
        label: 'Documents',
        href: '/portal/case/documents',
        icon: FileText,
        caption: 'Upload and check status',
        badge: activeCase && activeCase.docsActionRequired > 0 ? activeCase.docsActionRequired : undefined,
      },
      {
        label: 'Messages',
        href: '/portal/case/messages',
        icon: MessageSquare,
        caption: 'Your officer and updates',
        badge: activeCase && activeCase.unreadMessages > 0 ? activeCase.unreadMessages : undefined,
      },
      { label: 'Appointments', href: '/portal/case/appointments', icon: CalendarClock, caption: 'Biometrics, medical, interview' },
      { label: 'Timeline', href: '/portal/case/timeline', icon: Clock, caption: 'Case history' },
      { label: 'Notifications', href: '/portal/notifications', icon: Bell, caption: 'Everything that needs attention' },
      { label: 'Profile', href: '/portal/profile', icon: User, caption: 'Your information' },
    ],
    [activeCase],
  );

  const stageTone = activeCase ? (CLIENT_STAGE_TONE[activeCase.stage] as BadgeTone) : 'neutral';
  const stageLabel = activeCase ? CLIENT_STAGE_LABEL[activeCase.stage] : '—';

  function handleLogout() {
    logout();
    router.push('/login');
  }

  const initials = user.email
    .split('@')[0]
    ?.split(/[._-]/)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('') ?? 'C';

  return (
    <>
      {open ? <div className="sos-drawer-backdrop" onClick={onClose} aria-hidden /> : null}

      <nav className={`sos-sidebar${open ? ' is-open' : ''}`} aria-label="Client portal navigation" style={{ width: '260px' }}>
        <div className="sos-sidebar__brand">
          <div className="sos-sidebar__brand-logo">
            <CheckCircle2 size={22} />
          </div>
          <div className="sos-sidebar__brand-text">
            <div className="sos-sidebar__brand-name">Client Portal</div>
            <div className="sos-sidebar__brand-tagline">Tashfeen Immigration</div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '4px', display: 'none' }}
            className="portal-close-btn"
          >
            <X size={18} />
          </button>
        </div>

        {activeCase ? (
          <div className="sos-sidebar__panel" style={{ margin: '12px 12px 4px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--sos-sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '8px' }}>
              Your application
            </div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--sos-sidebar-text-strong)', marginBottom: '4px' }}>
              {activeCase.service}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--sos-sidebar-text-muted)', marginBottom: '10px' }}>
              {activeCase.targetCountry ?? '—'}
            </div>
            <StatusBadge tone={stageTone} size="sm">{stageLabel}</StatusBadge>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontSize: '11px', color: 'var(--sos-sidebar-text-muted)', marginBottom: '5px' }}>
                Documents: {activeCase.docsAccepted} / {activeCase.docsTotal} accepted
              </div>
              <div style={{ height: '5px', background: 'var(--sos-sidebar-progress-bg)', borderRadius: '999px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${activeCase.docsTotal === 0 ? 0 : Math.round((activeCase.docsAccepted / activeCase.docsTotal) * 100)}%`,
                    height: '100%',
                    background: 'var(--sos-brand-gradient)',
                    borderRadius: '999px',
                    transition: 'width 400ms',
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="sos-sidebar__nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/portal/case' && pathname.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className="sos-nav-link"
                onClick={onClose}
              >
                <span className="sos-nav-link__icon"><Icon size={17} /></span>
                <span className="sos-nav-link__body">
                  <span className="sos-nav-link__label">{item.label}</span>
                  <span className="sos-nav-link__caption">{item.caption}</span>
                </span>
                {item.badge ? <span className="sos-nav-link__badge">{item.badge}</span> : null}
              </a>
            );
          })}
        </div>

        <div className="sos-sidebar__user">
          <div className="sos-sidebar__user-avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-sidebar-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--sos-sidebar-text-muted)' }}>Client</div>
          </div>
          <button
            type="button"
            aria-label="Log out"
            onClick={handleLogout}
            style={{ background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '4px', borderRadius: '8px', transition: 'color 150ms' }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </nav>
    </>
  );
}

// ---------- Topbar --------------------------------------------------------

function PortalTopbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();

  function getTitle(path: string): { title: string; subtitle: string } {
    if (path === '/portal/case') return { title: 'My Case', subtitle: 'Your application overview' };
    if (path.startsWith('/portal/case/documents')) return { title: 'Documents', subtitle: 'Upload and track your documents' };
    if (path.startsWith('/portal/case/messages')) return { title: 'Messages', subtitle: 'Communication with your officer' };
    if (path.startsWith('/portal/case/appointments')) return { title: 'Appointments', subtitle: 'Biometrics, medical, interview, office visits' };
    if (path.startsWith('/portal/case/timeline')) return { title: 'Case Timeline', subtitle: 'History of your application' };
    if (path.startsWith('/portal/notifications')) return { title: 'Notifications', subtitle: 'Everything that needs your attention' };
    if (path.startsWith('/portal/profile')) return { title: 'Profile', subtitle: 'Your personal information' };
    return { title: 'Client Portal', subtitle: '' };
  }

  const { title, subtitle } = getTitle(pathname);

  return (
    <header className="sos-topbar">
      <button
        type="button"
        aria-label="Open menu"
        onClick={onMenuClick}
        className="sos-topbar__icon-btn"
        style={{ flexShrink: 0 }}
      >
        <Menu size={18} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sos-topbar__title">{title}</div>
        {subtitle ? (
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '1px' }}>{subtitle}</div>
        ) : null}
      </div>

      <ThemeToggle />
    </header>
  );
}

// ---------- Shell ---------------------------------------------------------

export function ClientPortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cases, setCases] = useState<PortalCaseSummary[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesError, setCasesError] = useState<string | null>(null);

  // Redirect non-clients away from the portal.
  useEffect(() => {
    if (session.status === 'unauthed') {
      router.replace('/login');
      return;
    }
    if (session.status === 'authed' && !session.user.roles.includes('client')) {
      router.replace('/login');
    }
  }, [session, router]);

  // Load this client's cases once the session is ready.
  const refreshCases = useMemo(
    () => async () => {
      setCasesLoading(true);
      setCasesError(null);
      try {
        const rows = await getMyCases();
        setCases(rows);
      } catch (err) {
        setCasesError(err instanceof Error ? err.message : 'Failed to load your case');
      } finally {
        setCasesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (session.status !== 'authed') return;
    if (!session.user.roles.includes('client')) return;
    void refreshCases();
  }, [session, refreshCases]);

  if (session.status === 'loading' || (session.status === 'authed' && casesLoading)) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        Loading your portal…
      </div>
    );
  }
  if (session.status !== 'authed') return null;

  if (casesError) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div className="sos-banner sos-banner--danger" style={{ maxWidth: 480, margin: '0 auto' }}>
          {casesError}
        </div>
      </div>
    );
  }

  const activeCase = cases[0] ?? null;
  const ctx: ClientSessionShape = {
    user: session.user,
    cases,
    activeCase,
    refreshCases,
  };

  return (
    <ClientSessionContext.Provider value={ctx}>
      <div className="sos-shell">
        <PortalSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={session.user}
          activeCase={activeCase}
        />
        <div className="sos-content">
          <PortalTopbar onMenuClick={() => setSidebarOpen(true)} />
          <main className="sos-page">{children}</main>
        </div>
      </div>
    </ClientSessionContext.Provider>
  );
}
