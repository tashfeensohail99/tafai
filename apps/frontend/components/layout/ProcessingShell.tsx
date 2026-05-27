'use client';
// Processing workspace shell — mirrors FinanceShell pattern.
// Sidebar with nav + live KPI panel, responsive off-canvas on mobile.

import {
  BarChart2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileSearch,
  FolderKanban,
  History,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Send,
  Settings2,
  Sparkles,
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
import {
  MOCK_PROCESSING_CASES,
  getIntakePending,
  countByStage,
} from '@/components/processing/mockData';
import { logout as sessionLogout, useSession } from '@/lib/session';

export interface ProcessingUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: string;
  roles: string[];
  permissions: string[];
}

interface ProcessingSessionContextValue {
  user: ProcessingUser;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const ProcessingSessionContext = createContext<ProcessingSessionContextValue | null>(null);

export function useProcessingSession(): ProcessingSessionContextValue {
  const ctx = useContext(ProcessingSessionContext);
  if (!ctx) {
    throw new Error('useProcessingSession must be used inside <ProcessingShell>');
  }
  return ctx;
}

const PROCESSING_ROLES = new Set([
  'processing',
  'processing_manager',
  'documentation',
  'super_admin',
  'admin',
]);

const PROCESSING_NAV: DrawerMenuItem[] = [
  { label: 'Dashboard', href: '/processing', icon: LayoutDashboard, caption: 'Officer overview' },
  { label: 'Intake Queue', href: '/processing/intake', icon: Inbox, caption: 'New from Finance', badge: getIntakePending().length || undefined },
  { label: 'My Cases', href: '/processing/cases', icon: FolderKanban, caption: 'Your active caseload' },
  { label: 'Documents', href: '/processing/documents', icon: FileSearch, caption: 'Pending reviews' },
  { label: 'Tasks', href: '/processing/tasks', icon: ClipboardList, caption: 'Open task list' },
  { label: 'History', href: '/processing/history', icon: History, caption: 'Completed cases' },
  { label: 'Reports', href: '/processing/reports', icon: BarChart2, caption: 'Metrics & analytics' },
];

const ADMIN_NAV: DrawerMenuItem[] = [
  { label: 'Manager Dashboard', href: '/processing/manager', icon: LayoutGrid, caption: 'Team & SLA overview' },
  { label: 'Checklist Templates', href: '/processing/admin/templates', icon: Settings2, caption: 'Document requirements' },
];

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/processing') return { title: 'Processing Dashboard', subtitle: 'Your active caseload today' };
  if (pathname === '/processing/intake') return { title: 'Intake Queue', subtitle: 'Cases handed over by Finance' };
  if (pathname.startsWith('/processing/cases/')) return { title: 'Case Workspace', subtitle: 'Full case view' };
  if (pathname === '/processing/cases') return { title: 'My Cases', subtitle: 'Your active cases' };
  if (pathname === '/processing/documents') return { title: 'Document Reviews', subtitle: 'Documents awaiting your review' };
  if (pathname === '/processing/tasks') return { title: 'My Tasks', subtitle: 'Open tasks across all cases' };
  if (pathname === '/processing/history') return { title: 'Case History', subtitle: 'Completed and cancelled cases' };
  if (pathname === '/processing/reports') return { title: 'Processing Reports', subtitle: 'Metrics & analytics' };
  if (pathname === '/processing/manager') return { title: 'Manager Dashboard', subtitle: 'Team workload & SLA overview' };
  if (pathname === '/processing/admin/templates') return { title: 'Checklist Templates', subtitle: 'Document requirement templates' };
  return { title: 'Processing Workspace', subtitle: '' };
}

export function ProcessingShell({ children }: { children: ReactNode }) {
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
      const hasAccess = session.user.roles.some((r) => PROCESSING_ROLES.has(r));
      if (!hasAccess) router.replace('/login');
    }
  }, [session, router]);

  // KPI bits (still backed by mock for now — the real numbers come from
  // /processing/dashboard, wired separately at page level).
  const intakePending = getIntakePending().length;
  const underReview = countByStage('DOCUMENTS_UNDER_REVIEW');
  const readyToSubmit = countByStage('READY_FOR_SUBMISSION');

  const sessionValue = useMemo<ProcessingSessionContextValue | null>(() => {
    if (session.status !== 'authed') return null;
    const emailHandle = session.user.email.split('@')[0] ?? 'officer';
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: emailHandle,
        initials: emailHandle.slice(0, 2).toUpperCase(),
        role: session.user.roles[0] ?? 'PROCESSING',
        roles: session.user.roles,
        permissions: session.user.permissions,
      },
      refreshUser: async () => {},
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

  const user = sessionValue.user;
  const logout = sessionValue.logout;
  const { title, subtitle } = getPageTitle(pathname);
  const activeCases = MOCK_PROCESSING_CASES.filter(
    (c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED',
  ).length;

  return (
    <ProcessingSessionContext.Provider value={sessionValue}>
      <div className="sos-shell">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Sparkles size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tashfeen</div>
              <div className="sos-sidebar__brand-tagline">Processing OS</div>
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
            <DrawerMenu items={PROCESSING_NAV} onNavigate={() => setMobileOpen(false)} />

            {user.permissions.includes('processing.case.view_all') ? (
              <>
                <div className="sos-nav-section" style={{ marginTop: '12px' }}>Admin</div>
                <DrawerMenu items={ADMIN_NAV} onNavigate={() => setMobileOpen(false)} />
              </>
            ) : null}

            <div className="sos-nav-section" style={{ marginTop: '12px' }}>Today</div>
            <div className="sos-sidebar__panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-sidebar-text-strong)' }}>
                <FolderKanban size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />
                Caseload snapshot
              </div>
              <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px', color: 'var(--sos-sidebar-text-muted)' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--sos-sidebar-text-strong)', fontSize: '18px' }}>{activeCases}</div>
                  <div>My active</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--sos-status-warning)', fontSize: '18px' }}>{intakePending}</div>
                  <div>New intake</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--sos-status-info)', fontSize: '18px' }}>{underReview}</div>
                  <div>Under review</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--sos-status-success)', fontSize: '18px' }}>{readyToSubmit}</div>
                  <div>Ready to file</div>
                </div>
              </div>
              {readyToSubmit > 0 ? (
                <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-success-soft)', border: '1px solid var(--sos-status-success-border)', fontSize: '11px', color: 'var(--sos-status-success)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={12} />
                  {readyToSubmit} case{readyToSubmit !== 1 ? 's' : ''} ready to file
                </div>
              ) : null}
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
          {/* Topbar */}
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
                <RoleBadge role="Processing" />
              </span>
            </div>
          </header>

          {/* Page content */}
          <main className="sos-page-content sos-scroll">
            {children}
          </main>
        </div>
      </div>
    </ProcessingSessionContext.Provider>
  );
}
