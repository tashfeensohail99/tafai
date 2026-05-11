import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';
import { RequestUser } from '../types/auth.types';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAnyPermissions = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permissions declared on this handler — allow authenticated users through
    if (
      (!requiredPermissions || requiredPermissions.length === 0) &&
      (!requiredAnyPermissions || requiredAnyPermissions.length === 0)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user: RequestUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    const hasAll =
      !requiredPermissions ||
      requiredPermissions.length === 0 ||
      requiredPermissions.every((perm) => user.permissions.includes(perm));

    const hasAny =
      !requiredAnyPermissions ||
      requiredAnyPermissions.length === 0 ||
      requiredAnyPermissions.some((perm) => user.permissions.includes(perm));

    if (!hasAll || !hasAny) {
      const missingAll = (requiredPermissions ?? []).filter(
        (perm) => !user.permissions.includes(perm),
      );
      throw new ForbiddenException(
        missingAll.length > 0
          ? `Missing required permissions: ${missingAll.join(', ')}`
          : `Missing one of the required permissions: ${(requiredAnyPermissions ?? []).join(', ')}`,
      );
    }

    return true;
  }
}
