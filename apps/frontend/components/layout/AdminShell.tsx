'use client';

import {
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  Flag,
  Handshake,
  LayoutDashboard,
  MapPinned,
  NotebookTabs,
  ShieldCheck,
  UserRoundCog,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from './AppShell';
import type { NavGroup } from './Sidebar';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { clearAccessToken, getAccessToken } from '@/lib/auth-client';

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

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, permissionKey: 'reports.view' },
      { label: 'Audit Log', href: '/admin/audit', icon: NotebookTabs, permissionKey: 'audit.view' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Employees', href: '/admin/employees', icon: UserRoundCog, permissionKey: 'employees.view_all' },
      { label: 'Roles', href: '/admin/roles', icon: ShieldCheck, permissionKey: 'settings.manage' },
      { label: 'Departments', href: '/admin/departments', icon: Building2, permissionKey: 'settings.manage' },
      { label: 'Branches', href: '/admin/branches', icon: MapPinned, permissionKey: 'settings.manage' },
      { label: 'Partners', href: '/admin/partners', icon: Handshake, permissionKey: 'partners.view_all' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { label: 'Leads', href: '/admin/leads', icon: Users, permissionKey: 'leads.view_all' },
      { label: 'Clients', href: '/admin/clients', icon: Users, permissionKey: 'clients.view_all' },
      { label: 'Appointments', href: '/admin/appointments', icon: CalendarDays, permissionKey: 'appointments.view_all' },
      { label: 'Finance', href: '/admin/finance', icon: BadgeDollarSign, permissionKey: 'finance.view_all' },
      { label: 'Cases', href: '/admin/cases', icon: BriefcaseBusiness, permissionKey: 'cases.view_all' },
      { label: 'Documents', href: '/admin/documents', icon: FileText, permissionKey: 'documents.view_all' },
      { label: 'Workflow Board', href: '/admin/workflow', icon: ClipboardList, permissionKey: 'reports.view' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Services', href: '/admin/settings/services', icon: BadgeDollarSign, permissionKey: 'settings.manage' },
      { label: 'Countries', href: '/admin/settings/countries', icon: Flag, permissionKey: 'settings.manage' },
    ],
  },
];

function getPageTitle(pathname: string): string {
  if (pathname === '/admin') {
    return 'Dashboard';
  }

  for (const group of ADMIN_NAV_GROUPS) {
    const match = group.items.find(
      (item) => item.href !== '/admin' && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
    );
    if (match) return match.label;
  }
  return 'Admin Portal';
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
      clearAccessToken();
      setUser(null);
      setError(err instanceof ApiClientError ? err.message : 'Unable to verify your session');
      router.replace('/login');
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearAccessToken();
    setUser(null);
    router.replace('/login');
  }

  useEffect(() => {
    void refreshUser();
  }, []);

  if (loading) {
    return <LoadingState fullPage message="Loading admin portal..." />;
  }

  if (!user) {
    return <LoadingState fullPage message="Redirecting to login..." />;
  }

  if (error && !user) {
    return <ErrorState message="Unable to open the admin portal" details={error} onRetry={() => void refreshUser()} />;
  }

  const visibleGroups = ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permissionKey || user.permissions.includes(item.permissionKey)),
  })).filter((group) => group.items.length > 0);

  const userName = user.email.split('@')[0] || user.email;
  const userRole = user.roles[0]?.replace(/_/g, ' ') ?? 'Staff';

  return (
    <AdminSessionContext.Provider value={{ user, refreshUser, logout }}>
      <AppShell
        navGroups={visibleGroups}
        logo={<span className="text-sm font-semibold">Tafsheen Admin</span>}
        pageTitle={getPageTitle(pathname)}
        userName={userName}
        userRole={userRole}
      >
        {children}
      </AppShell>
    </AdminSessionContext.Provider>
  );
}