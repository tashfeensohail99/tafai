import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { IsArray, IsIn } from 'class-validator';
import { WhatsAppTemplateDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';

const DEPARTMENTS: WhatsAppTemplateDepartment[] = ['SALES', 'FINANCE', 'PROCESSING'];

class SetTemplateDepartmentsDto {
  @IsArray()
  @IsIn(DEPARTMENTS, { each: true })
  departments!: WhatsAppTemplateDepartment[];
}

/**
 * Admin-only template routing. Lets an admin tag each WhatsApp template with the
 * department(s) allowed to pick it in the inbox composer (empty = shared). The
 * tags are our own metadata and survive the Meta template sync (the sync never
 * writes the `departments` column).
 *
 * Routes (base /v1/whatsapp/templates):
 *   GET  /            — every template (any status) with its department tags
 *   PATCH /:id        — set a template's department tags
 *
 * Permission: `whatsapp.manage_templates` (same gate as the sync action).
 */
@Controller('whatsapp/templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppTemplateAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('whatsapp.manage_templates')
  async listAll() {
    return this.prisma.whatsAppTemplate.findMany({
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
      select: {
        id: true,
        channelId: true,
        name: true,
        language: true,
        category: true,
        status: true,
        departments: true,
      },
    });
  }

  @Patch(':id')
  @RequirePermissions('whatsapp.manage_templates')
  async setDepartments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTemplateDepartmentsDto,
  ) {
    const unique = [...new Set(dto.departments)];
    return this.prisma.whatsAppTemplate.update({
      where: { id },
      data: { departments: { set: unique } },
      select: { id: true, name: true, language: true, departments: true },
    });
  }
}
