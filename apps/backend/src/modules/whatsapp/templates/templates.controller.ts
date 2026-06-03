import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { WhatsAppTemplateDepartment, WhatsAppTemplateStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Map a user's roles to the template departments they may pick from. Admins and
 * super-admins see everything. A template with NO department tags is shared and
 * shows to everyone regardless of role (see filterForUser).
 */
export function departmentsForRoles(roles: string[]): {
  all: boolean;
  depts: Set<WhatsAppTemplateDepartment>;
} {
  if (roles.includes('admin') || roles.includes('super_admin')) {
    return { all: true, depts: new Set() };
  }
  const depts = new Set<WhatsAppTemplateDepartment>();
  if (roles.includes('sales')) depts.add(WhatsAppTemplateDepartment.SALES);
  if (roles.includes('finance')) depts.add(WhatsAppTemplateDepartment.FINANCE);
  if (roles.includes('processing') || roles.includes('processing_manager')) {
    depts.add(WhatsAppTemplateDepartment.PROCESSING);
  }
  return { all: false, depts };
}

/**
 * Read-only template catalog. Used by the chat composer's template picker so
 * agents can send approved templates after the 24-hour window expires. Admin
 * sync of the catalog is a separate background job (TemplateSyncProcessor);
 * tagging templates by department is the admin controller alongside this one.
 *
 * Route: GET /v1/whatsapp/channels/:channelId/templates
 *   → APPROVED templates the caller's department may use (untagged = shared).
 */
@Controller('whatsapp/channels/:channelId/templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppTemplatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireAnyPermissions('whatsapp.send_message', 'whatsapp.view_all_inboxes')
  async list(
    @CurrentUser() user: RequestUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ) {
    const rows = await this.prisma.whatsAppTemplate.findMany({
      where: {
        channelId,
        status: WhatsAppTemplateStatus.APPROVED,
      },
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        components: true,
        qualityRating: true,
        departments: true,
      },
    });

    // Department scoping: admins see all; everyone else sees templates tagged
    // for one of their departments, plus untagged (shared) templates.
    const { all, depts } = departmentsForRoles(user.roles);
    if (all) return rows;
    return rows.filter(
      (t) => t.departments.length === 0 || t.departments.some((d) => depts.has(d)),
    );
  }
}
