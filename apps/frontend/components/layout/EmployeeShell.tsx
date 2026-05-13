'use client';

import {
  Bell,
  CalendarDays,
  ChevronRight,
  CirclePlus,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PhoneCall,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
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
import { PresencePill } from '@/components/whatsapp/PresencePill';
import { logout as sessionLogout, useSession } from '@/lib/session';
import { setMyPresence } from '@/lib/whatsapp';

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

const SALES_NAV: DrawerMenuItem[] = [
  { label: 'Dashboard', href: '/sales', icon: LayoutDashboard, caption: 'Workspace overview' },
  { label: 'WhatsApp Inbox', href: '/sales/inbox', icon: MessageSquare, caption: 'Your assigned chats' },
  { label: 'Assigned Leads', href: '/sales/leads', icon: Users, caption: 'CRM & social media', badge: 12 },
  { label: 'Create New Lead', href: '/sales/create-lead', icon: CirclePlus, caption: 'Walk-in client' },
  { label: 'Follow Ups', href: '/sales/follow-ups', icon: PhoneCall, caption: 'Calls, WhatsApp, reminders', badge: 7 },
  { label: 'Appointments', href: '/sales/appointments', icon: CalendarDays, caption: 'Meetings & visits' },
  { label: 'Decisions', href: '/sales/decisions', icon: ClipboardCheck, caption: 'Payment handover' },
];

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/sales') return { title: 'Sales Dashboard', subtitle: 'Your daily command center' };
  if (pathname.startsWith('/sales/inbox')) return { title: 'WhatsApp Inbox', subtitle: 'Your assigned conversations' };
  if (pathname.startsWith('/sales/leads/')) return { title: 'Lead Profile', subtitle: 'Edit progress, priority, and next action' };
  if (pathname === '/sales/leads') return { title: 'Assigned Leads', subtitle: 'Admin assigned and auto CRM leads' };
  if (pathname === '/sales/create-lead') return { title: 'Create New Lead', subtitle: 'Walk-in client intake' };
  if (pathname.startsWith('/sales/follow-ups/')) return { title: 'Follow-up Detail', subtitle: 'Update status, SLA, and outcome' };
  if (pathname === '/sales/follow-ups') return { title: 'Follow Ups', subtitle: 'Calls, WhatsApp and reminders' };
  if (pathname === '/sales/appointments') return { title: 'Appointments', subtitle: 'Bookings, consultations, and visits' };
  if (pathname === '/sales/decisions') return { title: 'Decisions', subtitle: 'Book next meeting or hand over to finance' };
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
      <div className="sos-shell">
        {/* Sidebar */}
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Sparkles size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tafsheen</div>
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
            <DrawerMenu items={SALES_NAV} onNavigate={() => setMobileOpen(false)} />

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
                Watch time-to-first-touch and stay ahead of overdue leads.
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
                    width: '72%',
                    height: '100%',
                    background: 'var(--sos-brand-gradient)',
                    borderRadius: '999px',
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
                <span>This week</span>
                <span style={{ color: 'var(--sos-brand-accent)', fontWeight: 600 }}>72% on time</span>
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
              <div className="sos-topbar__search">
                <Search size={14} />
                <input
                  type="search"
                  placeholder="Search leads, follow-ups, appointments…"
                  aria-label="Search workspace"
                />
                <kbd
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: '6px',
                    border: '1px solid var(--sos-border)',
                    color: 'var(--sos-text-faint)',
                    background: 'var(--sos-surface-2)',
                  }}
                >
                  ⌘K
                </kbd>
              </div>

              <ThemeToggle />

              <PresencePill />

              <button type="button" className="sos-topbar__icon-btn" aria-label="Notifications">
                <Bell size={15} />
              </button>

              <RoleBadge role={user.roles[0] ?? 'SALES'} />

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
            .sos-topbar__actions > .sos-pill,
            .sos-topbar__actions > span { display: none; }
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
