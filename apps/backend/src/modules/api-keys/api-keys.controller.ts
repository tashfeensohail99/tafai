import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';
import { SetActiveApiKeyDto, UpsertApiKeyDto } from './api-keys.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Admin "API Keys" tab — manage third-party secrets (OpenAI etc.) in one
 * place. All routes require `settings.manage`. Plaintext keys are accepted
 * inbound (one-shot) and never returned outbound (the response only carries
 * the last-4 tail for the masked preview).
 */
@Controller('admin/api-keys')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('settings.manage')
export class ApiKeysController {
  constructor(
    private readonly service: ApiKeysService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list() {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!org) return [];
    return this.service.list(org.id);
  }

  @Audit({ entityType: 'ApiKey', category: 'CONFIG', severity: 'CRITICAL', action: 'SETTING_CHANGED' })
  @Post()
  async upsert(@Body() dto: UpsertApiKeyDto, @CurrentUser() user: RequestUser) {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!org) throw new Error('No organization configured');
    return this.service.upsert(org.id, dto, user.id);
  }

  @Audit({ entityType: 'ApiKey', category: 'CONFIG', severity: 'CRITICAL', idParam: 'id', action: 'SETTING_CHANGED' })
  @Patch(':id')
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveApiKeyDto,
  ) {
    return this.service.setActive(id, dto.isActive);
  }

  @Audit({ entityType: 'ApiKey', category: 'CONFIG', severity: 'HIGH', idParam: 'id' })
  @Post(':id/test')
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.test(id);
  }

  @Audit({ entityType: 'ApiKey', category: 'CONFIG', severity: 'CRITICAL', idParam: 'id' })
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
