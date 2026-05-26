import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { OrchestratorService } from './orchestrator.service';

class TestQueryDto {
  @IsString()
  query!: string;
}

class SetBotConfigDto {
  @IsOptional()
  @IsString()
  botEnabledAt?: string | null;

  @IsOptional()
  @IsIn(['AUTO', 'SHADOW_ONLY', 'DISABLED'])
  botMode?: 'AUTO' | 'SHADOW_ONLY' | 'DISABLED';
}

/**
 * Admin-only endpoints for the AI bot: status, knowledge stats, config
 * (botEnabledAt + mode), and a "dry-run" tester so ops can see what the bot
 * would reply to a given query without sending it.
 */
@Controller('admin/ai')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('settings.manage')
export class AiAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /** Status + recent activity summary. */
  @Get('status')
  async status() {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, timezone: true, botEnabledAt: true, botMode: true },
    });
    const [knowledgeCount, last7days, modeBreakdown] = await Promise.all([
      this.knowledge.count(),
      this.prisma.aiRun.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.aiRun.groupBy({
        by: ['mode'],
        _count: { _all: true },
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);
    return {
      organization: org,
      knowledgeCount,
      last7days: {
        total: last7days,
        byMode: modeBreakdown.map((m) => ({ mode: m.mode, count: m._count._all })),
      },
    };
  }

  /** Update botEnabledAt + botMode from the admin UI. */
  @Post('config')
  async setConfig(@Body() dto: SetBotConfigDto) {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!org) throw new Error('No organization configured');
    const data: { botEnabledAt?: Date | null; botMode?: string } = {};
    if (dto.botEnabledAt !== undefined) {
      data.botEnabledAt = dto.botEnabledAt ? new Date(dto.botEnabledAt) : null;
    }
    if (dto.botMode !== undefined) data.botMode = dto.botMode;
    return this.prisma.organization.update({
      where: { id: org.id },
      data,
      select: { botEnabledAt: true, botMode: true },
    });
  }

  /**
   * Dry-run: returns what the bot WOULD reply to this query, without going
   * through a real WhatsApp thread. Used by the admin "test bot" tile.
   */
  @Post('dry-run')
  async dryRun(@Body() dto: TestQueryDto) {
    const matches = await this.knowledge.search(dto.query, 5);
    return { topMatches: matches };
  }
}
