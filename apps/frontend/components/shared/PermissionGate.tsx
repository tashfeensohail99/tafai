'use client';

/**
 * PermissionGate — conditionally renders children based on user permissions.
 *
 * IMPORTANT: This is a UX-only guard. Backend MUST still enforce permissions
 * on every protected API call. Never rely on this for security.
 *
 * Usage:
 *   <PermissionGate permission="leads.create">
 *     <CreateLeadButton />
 *   </PermissionGate>
 *
 *   <PermissionGate permissions={['cases.view_all', 'cases.update']} requireAll>
 *     <CaseEditForm />
 *   </PermissionGate>
 */

import type { ReactNode } from 'react';

interface PermissionGateProps {
  /** Single permission key required. */
  permission?: string;
  /** Multiple permission keys. Use with requireAll to control AND/OR logic. */
  permissions?: string[];
  /** If true, user must have ALL listed permissions. Default: any one is enough. */
  requireAll?: boolean;
  /** The user's current permission keys, passed from auth context/session. */
  userPermissions: string[];
  /** Content to render when permission check passes. */
  children: ReactNode;
  /** Optional fallback rendered when access is denied (default: null). */
  fallback?: ReactNode;
}

export function PermissionGate({
  permission,
  permissions = [],
  requireAll = false,
  userPermissions,
  children,
  fallback = null,
}: PermissionGateProps) {
  const required = permission ? [permission, ...permissions] : permissions;

  if (required.length === 0) {
    // No permission specified — render children (gate is open)
    return <>{children}</>;
  }

  const hasAccess = requireAll
    ? required.every((p) => userPermissions.includes(p))
    : required.some((p) => userPermissions.includes(p));

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
