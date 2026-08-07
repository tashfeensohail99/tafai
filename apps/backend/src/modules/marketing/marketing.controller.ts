import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MarketingService } from './marketing.service';
import { MarketingAlertsService } from './alerts.service';
import { MarketingHealthService } from './health.service';

class WindowQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

class ListQuery extends WindowQuery {
  @IsOptional()
  @IsBooleanString()
  includeIdle?: string;
}

/**
 * Marketing dashboard endpoints. All three are read-only aggregations for the
 * Phase 1D UI (Overview / Ads / Campaigns pages) and gate on `marketing.view`
 * — the base marketing permission granted to the marketing role in Phase 1A.
 */
@Controller('admin/marketing')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MarketingController {
  constructor(
    private readonly svc: MarketingService,
    private readonly alerts: MarketingAlertsService,
    private readonly health: MarketingHealthService,
  ) {}

  @Get('overview')
  @RequirePermissions('marketing.view')
  overview(@Query() q: WindowQuery) {
    return this.svc.getOverview(q.days);
  }

  @Get('ads')
  @RequirePermissions('marketing.view')
  ads(@Query() q: ListQuery) {
    return this.svc.getAds(q.days, q.includeIdle === 'true');
  }

  @Get('campaigns')
  @RequirePermissions('marketing.view')
  campaigns(@Query() q: ListQuery) {
    return this.svc.getCampaigns(q.days, q.includeIdle === 'true');
  }

  // Phase 1F — Alerts + Health, both read-only, both marketing.view.
  @Get('alerts')
  @RequirePermissions('marketing.view')
  alertsList() {
    return this.alerts.getAll();
  }

  @Get('health')
  @RequirePermissions('marketing.view')
  healthStatus() {
    return this.health.getStatus();
  }
}
