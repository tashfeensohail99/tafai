import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { SocialAlertService } from './social-alert.service';
import { SocialAlertConfigService } from './social-alert-config.service';
import { UpdateSocialAlertConfigDto } from './social-alerts.dto';

/**
 * Admin for the new-post → staff engagement alert. Config read/write + the
 * recent-alert log + a manual "poll now", all gated by `social.alerts.manage`.
 */
@Controller('admin/social-alerts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SocialAlertsController {
  constructor(
    private readonly svc: SocialAlertService,
    private readonly config: SocialAlertConfigService,
  ) {}

  @Get('config')
  @RequirePermissions('social.alerts.manage')
  async getConfig() {
    const [cfg, departments] = await Promise.all([this.config.get(), this.config.listDepartments()]);
    return {
      enabled: cfg.enabled,
      enabledAt: cfg.enabledAt,
      departments: cfg.departments,
      platforms: cfg.platforms,
      channels: cfg.channels,
      quietStartHour: cfg.quietStartHour,
      quietEndHour: cfg.quietEndHour,
      updatedAt: cfg.updatedAt,
      availableDepartments: departments,
    };
  }

  @Patch('config')
  @RequirePermissions('social.alerts.manage')
  @Audit({ entityType: 'SocialAlertConfig', category: 'CONFIG', severity: 'LOW' })
  update(@Body() dto: UpdateSocialAlertConfigDto) {
    return this.config.update(dto);
  }

  @Get('recent')
  @RequirePermissions('social.alerts.manage')
  recent(@Query('limit') limit?: string) {
    const n = limit !== undefined ? Number(limit) : 50;
    return this.svc.recentAlerts(Number.isFinite(n) && n > 0 ? n : 50);
  }

  @Post('poll')
  @RequirePermissions('social.alerts.manage')
  @Audit({ entityType: 'SocialAlertConfig', category: 'MUTATION', severity: 'LOW' })
  pollNow() {
    return this.svc.runPoll();
  }
}
