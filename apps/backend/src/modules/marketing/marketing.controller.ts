import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsBooleanString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MarketingService } from './marketing.service';
import { MarketingAlertsService } from './alerts.service';
import { MarketingHealthService } from './health.service';
import { MarketingAiInsightsService } from './ai-insights.service';

class WindowQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  // Explicit date window (YYYY-MM-DD). When BOTH are present they override
  // `days`; a single day is from === to. Trailing-days is used otherwise.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

class ListQuery extends WindowQuery {
  @IsOptional()
  @IsBooleanString()
  includeIdle?: string;
}

/**
 * Marketing dashboard endpoints. Reads only. Phase 1D covers Overview / Ads /
 * Campaigns aggregations (marketing.view); Phase 1F adds Alerts + Integration
 * Health (still marketing.view); Phase 1G adds advisory AI insights, scoped
 * to the narrower marketing.ai.view because the LLM call costs money.
 */
@Controller('admin/marketing')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MarketingController {
  constructor(
    private readonly svc: MarketingService,
    private readonly alerts: MarketingAlertsService,
    private readonly health: MarketingHealthService,
    private readonly ai: MarketingAiInsightsService,
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

  /**
   * Per-ad OUTCOMES for the Marketing team's Leads page — conversations count
   * and revenue/ROAS aggregated by ad. Deliberately aggregate-only: nothing on
   * the response identifies an individual lead.
   */
  @Get('leads')
  @RequirePermissions('marketing.view')
  leadsByAd(@Query() q: ListQuery) {
    return this.svc.getLeadsByAd(q.days, q.includeIdle === 'true', q.from, q.to);
  }

  /** Responses grouped by program (C11 / JR / Visit Visa / …), classified from
   *  the ad/campaign name. Aggregate only. */
  @Get('programs')
  @RequirePermissions('marketing.view')
  programs(@Query() q: WindowQuery) {
    return this.svc.getLeadsByProgram(q.days);
  }

  /**
   * Leads RECEIVED per rep in the window — the per-employee lead-volume monitor
   * the marketing team asked for. Counts only (total + ad-sourced split); no
   * revenue, no client/agreement data, no lead-level PII.
   */
  @Get('leads-by-rep')
  @RequirePermissions('marketing.view')
  leadsByRep(@Query() q: WindowQuery) {
    return this.svc.getLeadsByRep(q.days, q.from, q.to);
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

  // Phase 1G — advisory AI insights. Read is marketing.ai.view (scoped
  // narrower than marketing.view because the LLM call costs money and gets
  // its own permission per the Phase-1A perm sync).
  @Get('ai')
  @RequirePermissions('marketing.ai.view')
  aiInsights(@Query() q: WindowQuery) {
    return this.ai.get(q.days ?? 30, false);
  }

  @Post('ai/refresh')
  @RequirePermissions('marketing.ai.view')
  aiInsightsRefresh(@Query() q: WindowQuery) {
    return this.ai.get(q.days ?? 30, true);
  }
}
