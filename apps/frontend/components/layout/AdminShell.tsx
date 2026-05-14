'use client';

import {
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  Flag,
  Handshake,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  MessageSquare,
  NotebookTabs,
  Plug2,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  Users,
  UsersRound,
  Wrench,
  X,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DrawerMenu, type DrawerMenuItem } from '@/components/sales-v2/ui/DrawerMenu';
import { RoleBadge } from '@/components/sales-v2/ui/RoleBadge';
import { ThemeToggle } from './ThemeToggle';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { clearAllTokens, getAccessToken } from '@/lib/auth-client';
import { invalidateSessionCache } from '@/lib/session';

export interface AdminUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}

interface AdminSessionContextValue {
  user: AdminUser;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

interface AdminNavItem extends DrawerMenuItem {
  permissionKey?: string;
}

interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, caption: 'Operations overview', permissionKey: 'reports.view' },
      { label: 'Activity Logs', href: '/admin/audit', icon: NotebookTabs, caption: 'Audit trail', permissionKey: 'audit.view' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Users', href: '/admin/users', icon: UserRoundCog, caption: 'Accounts & access', permissionKey: 'users.view_all' },
      { label: 'Employees', href: '/admin/employees', icon: UsersRound, caption: 'Profiles & WhatsApp pool', permissionKey: 'employees.view_all' },
      { label: 'Roles', href: '/admin/roles', icon: ShieldCheck, caption: 'Permissions matrix', permissionKey: 'settings.manage' },
      { label: 'Departments', href: '/admin/departments', icon: Building2, caption: 'Org units', permissionKey: 'settings.manage' },
      { label: 'Branches', href: '/admin/branches', icon: MapPinned, caption: 'Locations', permissionKey: 'settings.manage' },
      { label: 'Partners', href: '/admin/partners', icon: Handshake, caption: 'Referral network', permissionKey: 'partners.view_all' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { label: 'Sales overview', href: '/admin/sales', icon: Users, caption: 'Per-agent KPIs', permissionKey: 'reports.view' },
      { label: 'Leads', href: '/admin/leads', icon: Users, caption: 'All inbound', permissionKey: 'leads.view_all' },
      { label: 'WhatsApp', href: '/admin/whatsapp', icon: MessageSquare, caption: 'All conversations', permissionKey: 'whatsapp.view_all_inboxes' },
      { label: 'Clients', href: '/admin/clients', icon: Users, caption: 'Converted accounts', permissionKey: 'clients.view_all' },
      { label: 'Appointments', href: '/admin/appointments', icon: CalendarDays, caption: 'Calendar', permissionKey: 'appointments.view_all' },
      { label: 'Finance', href: '/admin/finance', icon: BadgeDollarSign, caption: 'Invoices & payments', permissionKey: 'finance.view_all' },
      { label: 'Cases', href: '/admin/cases', icon: BriefcaseBusiness, caption: 'Legacy case ledger', permissionKey: 'cases.view_all' },
      { label: 'Processing', href: '/admin/processing', icon: ClipboardList, caption: 'Manager view', permissionKey: 'processing.case.view_all' },
      { label: 'Documents', href: '/admin/documents', icon: FileText, caption: 'Document pool', permissionKey: 'documents.view_all' },
      { label: 'Workflow Board', href: '/admin/workflow', icon: ClipboardList, caption: 'Kanban view', permissionKey: 'reports.view' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Services', href: '/admin/settings/services', icon: BadgeDollarSign, caption: 'Service catalog', permissionKey: 'settings.manage' },
      { label: 'Countries', href: '/admin/settings/countries', icon: Flag, caption: 'Target destinations', permissionKey: 'settings.manage' },
      { label: 'WhatsApp Channels', href: '/admin/settings/whatsapp/channels', icon: MessageSquare, caption: 'WABA numbers', permissionKey: 'whatsapp.manage_channels' },
      { label: 'WhatsApp Hours', href: '/admin/settings/whatsapp/hours', icon: Clock, caption: 'SLA + working hours', permissionKey: 'whatsapp.manage_settings' },
      { label: 'WhatsApp Team', href: '/admin/settings/whatsapp/team', icon: UsersRound, caption: 'Inbox roster', permissionKey: 'whatsapp.view_team_dashboard' },
      { label: 'Integrations', href: '/admin/settings/integrations', icon: Plug2, caption: 'Meta API & external keys', permissionKey: 'settings.manage' },
      { label: 'Finance maintenance', href: '/admin/settings/finance', icon: Wrench, caption: 'Orphan cleanup & finance tools', permissionKey: 'settings.manage' },
    ],
  },
];

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/admin') return { title: 'Admin Dashboard', subtitle: 'Operations overview' };
  if (pathname.startsWith('/admin/users')) return { title: 'Users', subtitle: 'Accounts & access control' };
  if (pathname.startsWith('/admin/audit')) return { title: 'Activity Logs', subtitle: 'Audit trail' };
  if (pathname.startsWith('/admin/employees')) return { title: 'Employees', subtitle: 'Profiles & WhatsApp pool' };
  if (pathname.startsWith('/admin/roles')) return { title: 'Roles & Permissions', subtitle: 'Permission matrix' };
  if (pathname.startsWith('/admin/departments')) return { title: 'Departments', subtitle: 'Organisational units' };
  if (pathname.startsWith('/admin/branches')) return { title: 'Branches', subtitle: 'Office locations' };
  if (pathname.startsWith('/admin/partners')) return { title: 'Partners', subtitle: 'Referral network' };
  if (pathname.startsWith('/admin/sales')) return { title: 'Sales overview', subtitle: 'Per-agent KPIs' };
  if (pathname.startsWith('/admin/leads')) return { title: 'Leads', subtitle: 'All inbound' };
  if (pathname.startsWith('/admin/whatsapp')) return { title: 'WhatsApp conversations', subtitle: 'All threads' };
  if (pathname.startsWith('/admin/clients')) return { title: 'Clients', subtitle: 'Converted accounts' };
  if (pathname.startsWith('/admin/appointments')) return { title: 'Appointments', subtitle: 'Calendar across the business' };
  if (pathname.startsWith('/admin/finance')) return { title: 'Finance', subtitle: 'Invoices, payments, revenue' };
  if (pathname.startsWith('/admin/cases')) return { title: 'Cases', subtitle: 'Legacy case ledger' };
  if (pathname.startsWith('/admin/processing')) return { title: 'Processing', subtitle: 'Manager view' };
  if (pathname.startsWith('/admin/documents')) return { title: 'Documents', subtitle: 'Document pool' };
  if (pathname.startsWith('/admin/workflow')) return { title: 'Workflow board', subtitle: 'Kanban across stages' };
  if (pathname.startsWith('/admin/settings/services')) return { title: 'Services', subtitle: 'Service catalog' };
  if (pathname.startsWith('/admin/settings/countries')) return { title: 'Countries', subtitle: 'Target destinations' };
  if (pathname.startsWith('/admin/settings/whatsapp/channels')) return { title: 'WhatsApp Channels', subtitle: 'Connected WABA numbers' };
  if (pathname.startsWith('/admin/settings/whatsapp/hours')) return { title: 'WhatsApp Hours & SLA', subtitle: 'Working hours + SLA' };
  if (pathname.startsWith('/admin/settings/whatsapp/team')) return { title: 'WhatsApp Team', subtitle: 'Inbox roster' };
  if (pathname.startsWith('/admin/settings/integrations')) return { title: 'Integrations', subtitle: 'External API credentials' };
  if (pathname.startsWith('/admin/settings/finance')) return { title: 'Finance maintenance', subtitle: 'Orphan cleanup & finance tools' };
  return { title: 'Admin', subtitle: '' };
}

export function useAdminSession(): AdminSessionContextValue {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error('useAdminSession must be used within AdminShell');
  }
  return context;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function refreshUser() {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const profile = await apiFetch<AdminUser>('/auth/me');
      setUser(profile);
    } catch (err) {
      clearAllTokens();
      setUser(null);
      setError(err instanceof ApiClientError ? err.message : 'Unable to verify your session');
      router.replace('/login');
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearAllTokens();
    invalidateSessionCache();
    setUser(null);
    router.replace('/login');
  }

  useEffect(() => {
    void refreshUser();
  }, []);

  if (loading) return <LoadingState fullPage message="Loading admin portal..." />;
  if (!user) return <LoadingState fullPage message="Redirecting to login..." />;
  if (error && !user) {
    return (
      <ErrorState
        message="Unable to open the admin portal"
        details={error}
        onRetry={() => void refreshUser()}
      />
    );
  }

  // Permission-filter every group.
  const visibleGroups = ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permissionKey || user.permissions.includes(item.permissionKey),
    ),
  })).filter((group) => group.items.length > 0);

  const userName = user.email.split('@')[0] || user.email;
  const userRole = user.roles[0]?.replace(/_/g, ' ') ?? 'Staff';
  const initials = userName.slice(0, 2).toUpperCase();
  const { title, subtitle } = getPageTitle(pathname);

  return (
    <AdminSessionContext.Provider value={{ user, refreshUser, logout }}>
      <div className="sos-shell">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside
          className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}
          aria-label="Admin navigation"
        >
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Sparkles size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tafsheen</div>
              <div className="sos-sidebar__brand-tagline">Admin OS</div>
            </div>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              style={{
                marginLeft: 'auto',
                background: 'transparent',
                border: 'none',
                color: 'var(--sos-sidebar-text-muted)',
                cursor: 'pointer',
                padding: 6,
              }}
              className="sos-mobile-close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="sos-sidebar__nav sos-scroll">
            {visibleGroups.map((group) => (
              <div key={group.label} style={{ marginBottom: 4 }}>
                <div className="sos-nav-section">{group.label}</div>
                <DrawerMenu items={group.items} onNavigate={() => setMobileOpen(false)} />
              </div>
            ))}
          </div>

          <div className="sos-sidebar__user">
            <div className="sos-sidebar__user-avatar">{initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--sos-sidebar-text-strong)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user.email}
              </div>
              <div style={{ fontSize: 11, color: 'var(--sos-sidebar-text-muted)' }}>
                {userRole}
              </div>
            </div>
            <button
              type="button"
              aria-label="Log out"
              onClick={logout}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--sos-sidebar-text-muted)',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 8,
                transition: 'color 150ms',
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        {/* ── Content ─────────────────────────────────────────────────── */}
        <div className="sos-content">
          <header className="sos-topbar">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="sos-topbar__icon-btn"
              style={{ flexShrink: 0 }}
            >
              <Menu size={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sos-topbar__title">{title}</div>
              {subtitle ? (
                <div
                  style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 1 }}
                >
                  {subtitle}
                </div>
              ) : null}
            </div>
            <span className="sos-topbar__optional">
              <RoleBadge role={userRole} />
            </span>
            <ThemeToggle />
          </header>
          <main className="sos-page">{children}</main>
        </div>
      </div>
    </AdminSessionContext.Provider>
  );
}
