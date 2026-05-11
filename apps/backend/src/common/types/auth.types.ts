import { Prisma } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface RequestUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}

/**
 * Typed result of a UserAccount query that includes roles → permissions.
 * Used to extract roles and permission keys without `any` casts.
 */
export type UserWithRolesAndPermissions = Prisma.UserAccountGetPayload<{
  include: {
    userRoles: {
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } };
          };
        };
      };
    };
  };
}>;

/** Extract role names and flat permission keys from a loaded user. */
export function extractRolesAndPermissions(user: UserWithRolesAndPermissions): {
  roles: string[];
  permissions: string[];
} {
  const roles = user.userRoles.map((ur) => ur.role.name);
  const permissions = [
    ...new Set<string>(
      user.userRoles.flatMap((ur) =>
        ur.role.rolePermissions.map((rp) => rp.permission.key),
      ),
    ),
  ];
  return { roles, permissions };
}
