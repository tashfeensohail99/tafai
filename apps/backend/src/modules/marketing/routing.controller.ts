import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdRoutingTargetType } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdRoutingRulesService } from './routing.service';

class UpsertRuleDto {
  @IsEnum(AdRoutingTargetType)
  targetType!: AdRoutingTargetType;
  @IsString()
  @MaxLength(64)
  targetId!: string;
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  branchIds!: string[];
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Marketing → Lead Routing admin surface. Read is `marketing.view` so any
 * marketing user can inspect the map; write is `marketing.routing.manage`
 * (only marketing/super_admin/admin carry this — see sync-marketing-perms).
 */
@Controller('admin/marketing/routing')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MarketingRoutingController {
  constructor(
    private readonly svc: AdRoutingRulesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('branches')
  @RequirePermissions('marketing.view')
  async branches() {
    const rows = await this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, city: true, country: true },
    });
    // Include per-branch active-employee count so the form can warn about
    // pinning an ad to a branch with nobody in it.
    const counts = await this.prisma.employee.groupBy({
      by: ['branchId'],
      where: { deletedAt: null, isActive: true, branchId: { in: rows.map((b) => b.id) } },
      _count: true,
    });
    const countBy = new Map(counts.map((c) => [c.branchId!, c._count]));
    return rows.map((b) => ({ ...b, employeeCount: countBy.get(b.id) ?? 0 }));
  }

  @Get('rules')
  @RequirePermissions('marketing.view')
  list() {
    return this.svc.list();
  }

  @Post('rules')
  @RequirePermissions('marketing.routing.manage')
  @Audit({ entityType: 'AdRoutingRule', category: 'CONFIG', severity: 'MEDIUM', action: 'SETTING_CHANGED' })
  upsert(@Body() dto: UpsertRuleDto, @Req() req: Request) {
    const userId = (req as unknown as { user?: { id?: string } }).user?.id ?? null;
    return this.svc.upsert({ ...dto, createdByUserId: userId });
  }

  @Delete('rules/:id')
  @RequirePermissions('marketing.routing.manage')
  @Audit({ entityType: 'AdRoutingRule', category: 'CONFIG', severity: 'MEDIUM', action: 'SETTING_CHANGED' })
  async remove(@Param('id') id: string) {
    await this.svc.remove(id);
    return { ok: true };
  }
}
