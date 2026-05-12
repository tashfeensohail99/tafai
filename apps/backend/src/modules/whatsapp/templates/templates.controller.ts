import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { WhatsAppTemplateStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Read-only template catalog. Used by the chat composer's template picker so
 * agents can send approved templates after the 24-hour window expires. Admin
 * sync of the catalog is a separate background job
 * (TemplateSyncProcessor); this controller just returns the rows.
 *
 * Permission: `whatsapp.send_message` (anyone allowed to send can pick).
 *
 * Route: GET /v1/whatsapp/channels/:channelId/templates
 *   → { id, name, language, category, components, qualityRating } only for
 *   APPROVED templates.
 */
@Controller('whatsapp/channels/:channelId/templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppTemplatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireAnyPermissions('whatsapp.send_message', 'whatsapp.view_all_inboxes')
  async list(@Param('channelId', ParseUUIDPipe) channelId: string) {
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
      },
    });
    return rows;
  }
}
