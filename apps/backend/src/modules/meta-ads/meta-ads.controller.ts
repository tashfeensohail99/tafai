import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { MetaAdsService } from './meta-ads.service';

class SyncSpendDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

/**
 * Admin controls for Meta ad-spend ingestion. Status is read-only; the manual
 * sync lets an admin pull spend on demand (e.g. right after wiring up the
 * `meta_ads` credential) without waiting for the 6-hour cron.
 */
@Controller('admin/meta-ads')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MetaAdsController {
  constructor(private readonly ads: MetaAdsService) {}

  // Read-only connection/coverage status — Marketing needs this for its
  // Integration Health page, so it accepts the scoped marketing key too. Admins
  // (settings.manage) keep access.
  @Get('status')
  @RequireAnyPermissions('settings.manage', 'marketing.ads.view')
  status() {
    return this.ads.getStatus();
  }

  // Manual spend pull stays admin-only — Marketing dashboards read the DB cache,
  // they never trigger a Meta sync themselves (workers own that).
  @Audit({ entityType: 'AdSpendDaily', category: 'CONFIG', severity: 'LOW', action: 'SETTING_CHANGED' })
  @Post('sync')
  @RequirePermissions('settings.manage')
  sync(@Body() dto: SyncSpendDto) {
    return this.ads.syncSpend(dto.days ?? 35);
  }
}
