'use client';
// Finance workspace shell — parallel to EmployeeShell.
// No theme provider here — the root layout owns that. We only consume
// useTheme via ThemeToggle in the topbar.

import {
  Bell,
  ChevronRight,
  FileSignature,
  FileText,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareWarning,
  Receipt,
  Search,
  Send,
  Sparkles,
  Wallet,
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
import {
  collectedToday,
  countByStatus,
  fmtAmount,
  readyForProcessingCount,
  verifiedTodayCount,
} from '@/components/finance-v1/mockData';
import { logout as sessionLogout, useSession } from '@/lib/session';

export interface FinanceUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
}

interface FinanceSessionContextValue {
  user: FinanceUser;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const FinanceSessionContext = createContext<FinanceSessionContextValue | null>(null);

const FINANCE_NAV: DrawerMenuItem[] = [
  { label: 'Dashboard', href: '/finance', icon: LayoutDashboard, caption: 'Officer overview' },
  { label: 'Agreements', href: '/finance/agreements', icon: FileText, caption: 'Review & approve from Sales' },
  { label: 'Contracts', href: '/finance/contracts', icon: FileSignature, caption: 'Service contracts + installments' },
  { label: 'Intake Queue', href: '/finance/intake', icon: Inbox, caption: 'Cases from Sales', badge: 3 },
  { label: 'Corrections', href: '/finance/corrections', icon: MessageSquareWarning, caption: 'Sent back to Sales', badge: 2 },
  { label: 'Receipts', href: '/finance/receipts', icon: Receipt, caption: 'Confirm + issue' },
  { label: 'Send to Processing', href: '/finance/handover', icon: Send, caption: 'Ready cases', badge: 2 },
  { label: 'Payment History', href: '/finance/history', icon: History, caption: 'Searchable audit log' },
];

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/finance') return { title: 'Finance Dashboard', subtitle: 'Your verification queue today' };
  if (pathname.startsWith('/finance/agreements/')) return { title: 'Agreement Review', subtitle: 'Approve, request changes, generate the contract' };
  if (pathname === '/finance/agreements') return { title: 'Agreements', subtitle: 'Submitted by Sales for review' };
  if (pathname.startsWith('/finance/contracts/')) return { title: 'Service Contract', subtitle: 'Installment schedule + invoice generation' };
  if (pathname === '/finance/contracts') return { title: 'Service Contracts', subtitle: 'Signed agreements + installment plans' };
  if (pathname.startsWith('/finance/intake/')) return { title: 'Payment Verification', subtitle: 'Verify the receipt and amount' };
  if (pathname === '/finance/intake') return { title: 'Finance Intake', subtitle: 'Cases handed over by Sales' };
  if (pathname.startsWith('/finance/corrections/')) return { title: 'Correction Thread', subtitle: 'Conversation with Sales' };
  if (pathname === '/finance/corrections') return { title: 'Corrections', subtitle: 'Sent back to Sales for fixing' };
  if (pathname.startsWith('/finance/receipts/')) return { title: 'Receipt Confirmation', subtitle: 'Generate and issue the receipt' };
  if (pathname === '/finance/receipts') return { title: 'Receipts', subtitle: 'Issue final payment receipts' };
  if (pathname === '/finance/handover') return { title: 'Send to Processing', subtitle: 'Verified cases awaiting handover' };
  if (pathname === '/finance/history') return { title: 'Payment History', subtitle: 'All verified, rejected, and refunded payments' };
  return { title: 'Finance Workspace', subtitle: '' };
}

export function useFinanceSession(): FinanceSessionContextValue {
  const context = useContext(FinanceSessionContext);
  if (!context) {
    throw new Error('useFinanceSession must be used inside <FinanceShell>');
  }
  return context;
}

const FINANCE_ROLES = new Set([
  'finance',
  'finance_manager',
  'super_admin',
  'admin',
]);

export function FinanceShell({ children }: { children: ReactNode }) {
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
      const hasAccess = session.user.roles.some((r) => FINANCE_ROLES.has(r));
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

  const emailHandle = session.user.email.split('@')[0] ?? 'finance';
  const user: FinanceUser = {
    id: session.user.id,
    email: session.user.email,
    name: emailHandle,
    roles: session.user.roles,
    permissions: session.user.permissions,
  };

  function logout() {
    sessionLogout();
    router.replace('/login');
  }

  const { title, subtitle } = getPageTitle(pathname);
  const initials = emailHandle.slice(0, 2).toUpperCase();

  // Mini-panel data for the sidebar
  const collected = collectedToday();
  const verifiedCount = verifiedTodayCount();
  const readyCount = readyForProcessingCount();
  const newFromSales = countByStatus('NEW_FROM_SALES');
  const dailyTarget = 15;
  const progressPct = Math.min(100, Math.round((verifiedCount / dailyTarget) * 100));

  return (
    <FinanceSessionContext.Provider value={{ user, refreshUser: async () => {}, logout }}>
      <div className="sos-shell">
        {/* Sidebar */}
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Sparkles size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tashfeen</div>
              <div className="sos-sidebar__brand-tagline">Finance OS</div>
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
            <DrawerMenu items={FINANCE_NAV} onNavigate={() => setMobileOpen(false)} />

            <div className="sos-nav-section" style={{ marginTop: '12px' }}>
              Today
            </div>
            <div className="sos-sidebar__panel">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: 'var(--sos-sidebar-text-strong)',
                }}
              >
                <Wallet size={14} style={{ color: 'var(--sos-brand-accent)' }} />
                Collected today
              </div>
              <div
                style={{
                  marginTop: '6px',
                  fontSize: '20px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--sos-sidebar-text-strong)',
                }}
              >
                {fmtAmount(collected.amount, collected.currency)}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--sos-sidebar-text-muted)',
                  marginTop: '2px',
                }}
              >
                {verifiedCount} of {dailyTarget} verified
              </div>
              <div
                style={{
                  marginTop: '10px',
                  height: '6px',
                  background: 'var(--sos-sidebar-progress-bg)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: progressPct + '%',
                    height: '100%',
                    background: 'var(--sos-brand-gradient)',
                    borderRadius: '999px',
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: '10px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  fontSize: '11px',
                  color: 'var(--sos-sidebar-text-muted)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--sos-sidebar-text-strong)' }}>
                    {newFromSales}
                  </div>
                  <div>New from Sales</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--sos-sidebar-text-strong)' }}>
                    {readyCount}
                  </div>
                  <div>Ready to send</div>
                </div>
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
                }}
              >
                {user.name}
              </div>
              <div
                style={{
                  color: 'var(--sos-sidebar-text-muted)',
                  fontSize: '11px',
                }}
              >
                Finance Officer
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
                <span>Finance</span>
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
                  placeholder="Search by client, receipt no, reference…"
                  aria-label="Search finance workspace"
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

              <button type="button" className="sos-topbar__icon-btn" aria-label="Notifications">
                <Bell size={15} />
              </button>

              <span className="sos-topbar__optional">
                <RoleBadge role={user.roles[0] ?? 'FINANCE'} />
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
                    }}
                  >
                    {user.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--sos-text-faint)' }}>
                    {subtitle || 'Finance'}
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="sos-page">{children}</main>
        </div>

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
            .sos-topbar__optional { display: none; }
            .sos-topbar__actions { gap: 8px; }
          }
          @media (max-width: 480px) {
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
    </FinanceSessionContext.Provider>
  );
}
