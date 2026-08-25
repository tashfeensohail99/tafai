'use client';

import {
  CalendarDays,
  ChevronRight,
  CirclePlus,
  FileText,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneCall,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { CallDock } from '@/components/whatsapp/CallDock';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { DrawerMenu, type DrawerMenuItem } from '@/components/sales-v2/ui/DrawerMenu';
import { RoleBadge } from '@/components/sales-v2/ui/RoleBadge';
import { ThemeToggle } from './ThemeToggle';
import { NotificationsBell } from './NotificationsBell';
import { PresencePill } from '@/components/whatsapp/PresencePill';
import { PresenceWarnings } from '@/components/whatsapp/PresenceWarnings';
import { logout as sessionLogout, useSession } from '@/lib/session';
import { setMyPresence, getMyMissedCallCount } from '@/lib/whatsapp';
import { fetchMySalesStats, type MySalesStats } from '@/lib/sales-api';
import { fetchAgreementReviewCounts } from '@/lib/agreements';

export interface EmployeeUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}

interface EmployeeSessionContextValue {
  user: EmployeeUser;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const EmployeeSessionContext = createContext<EmployeeSessionContextValue | null>(null);

// Badges are filled from the live /leads/my-stats counts (null until loaded —
// no badge shown rather than a stale placeholder number).
function buildSalesNav(stats: MySalesStats | null, missedCalls: number): DrawerMenuItem[] {
  return [
    { label: 'Dashboard', href: '/sales', icon: LayoutDashboard, caption: 'Workspace overview' },
    { label: 'WhatsApp Inbox', href: '/sales/inbox', icon: MessageSquare, caption: 'Your assigned chats' },
    { label: 'Messenger', href: '/sales/messenger', icon: MessageCircle, caption: 'Facebook Messenger chats' },
    {
      label: 'Calls',
      href: '/sales/calls',
      icon: Phone,
      caption: 'Missed & answered calls',
      ...(missedCalls > 0 ? { badge: missedCalls } : {}),
    },
    { label: 'WhatsApp Status', href: '/sales/status', icon: Sparkles, caption: 'Post to WA Status (pilot)' },
    { label: 'CSV Leads', href: '/sales/csv-leads', icon: FileSpreadsheet, caption: 'From spreadsheet uploads' },
    {
      label: 'Assigned Leads',
      href: '/sales/leads',
      icon: Users,
      caption: 'CRM & social media',
      ...(stats && stats.assignedLeads > 0 ? { badge: stats.assignedLeads } : {}),
    },
    { label: 'Create New Lead', href: '/sales/create-lead', icon: CirclePlus, caption: 'Walk-in client' },
    {
      label: 'Follow Ups',
      href: '/sales/follow-ups',
      icon: PhoneCall,
      caption: 'Calls, WhatsApp, reminders',
      ...(stats && stats.openFollowUps > 0 ? { badge: stats.openFollowUps } : {}),
    },
    { label: 'Appointments', href: '/sales/appointments', icon: CalendarDays, caption: 'Meetings & visits' },
    { label: 'Bot Requests', href: '/sales/appointment-requests', icon: Sparkles, caption: 'AI-captured booking intents' },
    { label: 'Agreements', href: '/sales/agreements', icon: FileText, caption: 'Service agreements' },
  ];
}

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/sales') return { title: 'Sales Dashboard', subtitle: 'Your daily command center' };
  if (pathname.startsWith('/sales/messenger')) return { title: 'Messenger', subtitle: 'Your assigned Messenger chats' };
  if (pathname.startsWith('/sales/inbox')) return { title: 'WhatsApp Inbox', subtitle: 'Your assigned conversations' };
  if (pathname.startsWith('/sales/calls')) return { title: 'Calls', subtitle: 'Your missed and answered calls' };
  if (pathname.startsWith('/sales/status')) return { title: 'WhatsApp Status', subtitle: 'Compose, schedule, and track Status posts' };
  if (pathname.startsWith('/sales/csv-leads')) return { title: 'CSV Leads', subtitle: 'Leads from spreadsheet uploads' };
  if (pathname.startsWith('/sales/leads/')) return { title: 'Lead Profile', subtitle: 'Edit progress, priority, and next action' };
  if (pathname === '/sales/leads') return { title: 'Assigned Leads', subtitle: 'Admin assigned and auto CRM leads' };
  if (pathname === '/sales/create-lead') return { title: 'Create New Lead', subtitle: 'Walk-in client intake' };
  if (pathname.startsWith('/sales/follow-ups/')) return { title: 'Follow-up Detail', subtitle: 'Update status, SLA, and outcome' };
  if (pathname === '/sales/follow-ups') return { title: 'Follow Ups', subtitle: 'Calls, WhatsApp and reminders' };
  if (pathname === '/sales/appointments') return { title: 'Appointments', subtitle: 'Bookings, consultations, and visits' };
  if (pathname === '/sales/appointment-requests') return { title: 'Bot appointment requests', subtitle: 'AI-captured day/time/modality preferences awaiting confirmation' };
  if (pathname.startsWith('/sales/agreements/new')) return { title: 'New Agreement', subtitle: 'Pick a category to start' };
  if (pathname.startsWith('/sales/agreements/')) return { title: 'Agreement', subtitle: 'Bio, payment plan, and review' };
  if (pathname === '/sales/agreements') return { title: 'Agreements', subtitle: 'Your service agreements' };
  return { title: 'Sales Workspace', subtitle: '' };
}

export function useEmployeeSession(): EmployeeSessionContextValue {
  const context = useContext(EmployeeSessionContext);
  if (!context) {
    throw new Error('useEmployeeSession must be used inside <EmployeeShell>');
  }
  return context;
}

/** Roles that should land on /sales after login. */
const SALES_ROLES = new Set([
  'sales',
  'sales_manager',
  'super_admin',
  'admin',
]);

export function EmployeeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [stats, setStats] = useState<MySalesStats | null>(null);
  const [changesCount, setChangesCount] = useState(0);
  const [missedCalls, setMissedCalls] = useState(0);

  // Live sidebar counters. Fetched once on auth and then refreshed in the
  // background every 60s — NOT on every navigation. Refetching on `pathname`
  // change was firing two backend round-trips (~1s combined) on top of every
  // page's own data fetch, making navigation feel sluggish.
  useEffect(() => {
    if (session.status !== 'authed') return;
    let cancelled = false;
    const load = () => {
      fetchMySalesStats()
        .then((s) => {
          if (!cancelled) setStats(s);
        })
        .catch(() => {
          /* sidebar badges are best-effort — never block the shell */
        });
      // "Agreements needing changes" badge — Finance bounced them back to me.
      fetchAgreementReviewCounts()
        .then((c) => {
          if (!cancelled) setChangesCount(c.salesChangesRequested);
        })
        .catch(() => {});
      // Missed-call badge on the Calls nav item (last 24h).
      getMyMissedCallCount()
        .then((r) => {
          if (!cancelled) setMissedCalls(r.count);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session.status]);

  useEffect(() => {
    if (session.status === 'unauthed') {
      router.replace('/login');
      return;
    }
    if (session.status === 'authed') {
      const hasAccess = session.user.roles.some((r) => SALES_ROLES.has(r));
      if (!hasAccess) router.replace('/login');
    }
  }, [session, router]);

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        Loading workspace…
      </div>
    );
  }
  if (session.status !== 'authed') return null;

  const user: EmployeeUser = session.user;

  async function logout() {
    // Set presence OFFLINE before clearing the JWT so the backend call
    // is still authenticated. Best-effort — if it fails we still log out.
    try {
      await setMyPresence('OFFLINE');
    } catch {
      // ignore
    }
    sessionLogout();
    router.replace('/login');
  }

  const { title, subtitle } = getPageTitle(pathname);
  const userName = user.email.split('@')[0] ?? 'sales';
  const initials = userName.slice(0, 2).toUpperCase();

  return (
    <EmployeeSessionContext.Provider value={{ user, refreshUser: async () => {}, logout }}>
      {/* Availability warning popups (Away > 10 min / Offline > 2h) */}
      <PresenceWarnings />
      <div className="sos-shell">
        {/* Sidebar */}
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Sparkles size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tashfeen</div>
              <div className="sos-sidebar__brand-tagline">Sales OS</div>
            </div>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="sos-mobile-close"
              style={{
                marginLeft: 'auto',
                background: 'transparent',
                border: 'none',
                color: 'var(--sos-sidebar-text-muted)',
                cursor: 'pointer',
                padding: '6px',
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div className="sos-sidebar__nav sos-scroll">
            <div className="sos-nav-section">Workspace</div>
            <DrawerMenu
              items={buildSalesNav(stats, missedCalls).map((it) =>
                it.href === '/sales/agreements' && changesCount ? { ...it, badge: changesCount } : it,
              )}
              onNavigate={() => setMobileOpen(false)}
            />

            <div className="sos-nav-section" style={{ marginTop: '12px' }}>
              Resources
            </div>
            <div className="sos-sidebar__panel">
              <div
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: 'var(--sos-sidebar-text-strong)',
                }}
              >
                SLA tracker
              </div>
              <div
                style={{
                  fontSize: '11.5px',
                  color: 'var(--sos-sidebar-text-muted)',
                  marginTop: '4px',
                  lineHeight: 1.55,
                }}
              >
                {stats && stats.overdueFollowUps > 0
                  ? `${stats.overdueFollowUps} follow-up${stats.overdueFollowUps === 1 ? '' : 's'} overdue — clear them to lift your score.`
                  : 'Reply on time to keep your response score high.'}
              </div>
              <div
                style={{
                  marginTop: '12px',
                  height: '6px',
                  background: 'var(--sos-sidebar-progress-bg)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${stats?.slaScore ?? 100}%`,
                    height: '100%',
                    background: 'var(--sos-brand-gradient)',
                    borderRadius: '999px',
                    transition: 'width 400ms',
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: '8px',
                  fontSize: '11px',
                  color: 'var(--sos-sidebar-text-muted)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Response SLA</span>
                <span style={{ color: 'var(--sos-brand-accent)', fontWeight: 600 }}>
                  {stats?.slaScore ?? 100}% on time
                </span>
              </div>
            </div>
          </div>

          <div className="sos-sidebar__user">
            <div className="sos-sidebar__user-avatar">{initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  color: 'var(--sos-sidebar-text-strong)',
                  fontSize: '13px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                }}
              >
                {userName}
              </div>
              <div
                style={{
                  color: 'var(--sos-sidebar-text-muted)',
                  fontSize: '11px',
                }}
              >
                Sales Representative
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Logout"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--sos-sidebar-text-muted)',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '10px',
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        {mobileOpen ? (
          <div aria-hidden onClick={() => setMobileOpen(false)} className="sos-drawer-backdrop" />
        ) : null}

        {/* Content */}
        <div className="sos-content">
          <header className="sos-topbar">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="sos-topbar__icon-btn sos-mobile-toggle"
            >
              <Menu size={16} />
            </button>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sos-breadcrumb">
                <span>Sales</span>
                <ChevronRight size={12} />
                <span className="sos-breadcrumb__current">{title}</span>
              </div>
              <div className="sos-topbar__title">{title}</div>
            </div>

            <div className="sos-topbar__actions">
              {/* Global workspace search removed — it was a non-functional
                  placeholder (no handler) that showed a broken search box on
                  every employee page. Real lead search lives on /sales/leads. */}
              <ThemeToggle />

              <span className="sos-topbar__optional">
                <PresencePill />
              </span>

              <NotificationsBell iconSize={15} />

              <span className="sos-topbar__optional">
                <RoleBadge role={user.roles[0] ?? 'SALES'} />
              </span>

              <div className="sos-topbar__user">
                <div className="sos-sidebar__user-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                  {initials}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--sos-text-primary)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {userName}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--sos-text-faint)' }}>
                    {subtitle || 'Sales'}
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="sos-page">{children}</main>
        </div>

        {/* Global WhatsApp softphone — rings the assigned rep on any page (Phase 1). */}
        <CallDock />

        {/* Responsive helpers — kept here so tokens stay the source of truth */}
        <style>{`
          .sos-mobile-toggle { display: none; }
          .sos-mobile-close { display: none; }
          .sos-topbar__actions {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          @media (max-width: 1023px) {
            .sos-mobile-toggle { display: grid; }
            .sos-mobile-close { display: inline-flex; }
            .sos-topbar__search { display: none; }
            .sos-topbar__user > div:nth-child(2) { display: none; }
          }
          @media (max-width: 720px) {
            .sos-topbar__user { display: none; }
            /* Hide presence pill + role badge on phones so the topbar
               doesn't crowd the page title. Both are wrapped in
               .sos-topbar__optional. */
            .sos-topbar__optional { display: none; }
            .sos-topbar__actions { gap: 8px; }
          }
          @media (max-width: 480px) {
            /* On the smallest phones, lose the breadcrumb so only the
               page title remains alongside hamburger + theme + bell. */
            .sos-breadcrumb { display: none; }
          }
          @media (min-width: 1280px) {
            .sos-detail-grid {
              grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr) !important;
            }
          }
          @media (max-width: 1100px) {
            .sos-detail-grid {
              grid-template-columns: minmax(0, 1fr) !important;
            }
          }
        `}</style>
      </div>
    </EmployeeSessionContext.Provider>
  );
}
