export interface PortalUser {
  roles: string[];
  permissions: string[];
}

const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const SALES_PERMISSION_KEYS = [
  'leads.view_assigned',
  'leads.create',
  'appointments.view_assigned',
  'appointments.create',
];

export function getDefaultPortalPath(user: PortalUser): '/admin' | '/sales' {
  return user.roles.some((role) => ADMIN_ROLES.has(role)) ? '/admin' : '/sales';
}

export function hasSalesWorkspaceAccess(user: PortalUser): boolean {
  return user.roles.includes('sales') || SALES_PERMISSION_KEYS.some((key) => user.permissions.includes(key));
}

export function formatRoleLabel(role: string): string {
  return role
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}