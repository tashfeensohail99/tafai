import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { OrchestratorService } from './orchestrator.service';
import { WHATSAPP_QUEUE, type AiReplyJob } from '../whatsapp/queues/queue-contracts';

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

class KnowledgeUpsertDto {
  @IsString()
  @MinLength(3)
  queryEn!: string;

  @IsString()
  @MinLength(3)
  answerEn!: string;

  @IsOptional()
  @IsString()
  answerUr?: string;

  @IsOptional()
  @IsString()
  programKey?: string;
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
    @InjectQueue(WHATSAPP_QUEUE.AI_REPLY)
    private readonly aiReplyQueue: Queue<AiReplyJob>,
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
  @Audit({ entityType: 'AiConfig', category: 'CONFIG', severity: 'HIGH', action: 'SETTING_CHANGED' })
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

  // ── Knowledge editor (admin CRUD; the bot's RAG facts). Each save embeds
  //    the question+answer so retrieval picks it up immediately. ────────────
  @Get('knowledge')
  async listKnowledge(@Query('search') search?: string, @Query('limit') limit?: string) {
    return this.knowledge.listEntries({
      search: search || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('knowledge')
  async createKnowledge(@Body() dto: KnowledgeUpsertDto) {
    const id = await this.knowledge.saveEntry(dto);
    return this.knowledge.getEntry(id);
  }

  @Put('knowledge/:id')
  async updateKnowledge(@Param('id') id: string, @Body() dto: KnowledgeUpsertDto) {
    await this.knowledge.saveEntry({ ...dto, id });
    return this.knowledge.getEntry(id);
  }

  @Delete('knowledge/:id')
  async removeKnowledge(@Param('id') id: string) {
    await this.knowledge.deleteEntry(id);
    return { id, deleted: true };
  }

  /**
   * Recent AI runs for the admin "what's the bot been saying" panel. Joins
   * each run with the original inbound message + the outbound reply (when
   * AUTO / OPT_OUT) so the UI can show "Client said X → Bot said Y" inline.
   * Last 50 by default.
   */
  @Get('recent-runs')
  async recentRuns() {
    const runs = await this.prisma.aiRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        threadId: true,
        inboundMessageId: true,
        mode: true,
        skipReason: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        totalLatencyMs: true,
        topMatchSimilarity: true,
        outboundMessageId: true,
        createdAt: true,
      },
    });

    // Join inbound + outbound bodies. One findMany each to avoid N+1.
    const messageIds = [
      ...new Set([
        ...runs.map((r) => r.inboundMessageId),
        ...runs.map((r) => r.outboundMessageId).filter((id): id is string => !!id),
      ]),
    ];
    const messages = await this.prisma.whatsAppMessage.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, body: true, type: true, createdAt: true },
    });
    const msgMap = new Map(messages.map((m) => [m.id, m]));

    // Also fetch lead names so the UI can show who the conversation is with.
    const threadIds = [...new Set(runs.map((r) => r.threadId))];
    const threads = await this.prisma.whatsAppThread.findMany({
      where: { id: { in: threadIds } },
      select: {
        id: true,
        lead: { select: { firstName: true, lastName: true, phone: true } },
      },
    });
    const threadMap = new Map(threads.map((t) => [t.id, t]));

    return runs.map((r) => {
      const inbound = msgMap.get(r.inboundMessageId);
      const outbound = r.outboundMessageId ? msgMap.get(r.outboundMessageId) : null;
      const t = threadMap.get(r.threadId);
      return {
        ...r,
        inboundText: inbound?.body ?? null,
        inboundType: inbound?.type ?? null,
        outboundText: outbound?.body ?? null,
        outboundType: outbound?.type ?? null,
        lead: t?.lead ?? null,
      };
    });
  }

  /**
   * Backfill: enqueue an AI-reply job for every thread that has an open
   * 24-hour window AND a pending unanswered customer message AND is not a
   * paid client / human-active / explicitly AI-disabled. The AiReplyProcessor
   * applies all the same per-thread guards before composing, so this is
   * idempotent + safe to re-run — duplicates are caught by the unique
   * `ai.runs.inboundMessageId` constraint.
   *
   * "Unanswered" = thread.responseDeadlineAt IS NOT NULL (the existing
   * agent-turn clock). Cleared automatically when an agent replies, so this
   * filter only picks up threads waiting on us.
   *
   * Jobs are staggered with a small per-message delay so we don't burst N
   * OpenAI calls into the rate limiter all at once.
   */
  @Audit({ entityType: 'AiBackfill', category: 'MUTATION', severity: 'HIGH' })
  @Post('backfill-open-window')
  async backfillOpenWindow() {
    const now = new Date();

    // 1) Threads with open WhatsApp window + agent-turn clock running. We
    //    no longer pre-filter by `aiDisabledAt`: the orchestrator's per-
    //    inbound "human-replied-since" check (see orchestrator.decide) is
    //    precise and supersedes the old coarse lockout window. The loop
    //    below ALSO pre-checks `humanReplyAfter` before enqueueing, so we
    //    don't burst OpenAI calls on threads sales is actively working.
    const threads = await this.prisma.whatsAppThread.findMany({
      where: {
        status: 'OPEN',
        aiEnabled: true,
        windowExpiresAt: { gt: now },
        responseDeadlineAt: { not: null },
        // Skip threads already linked to a converted client — paid clients
        // get further filtered (processing/finance) inside the orchestrator.
        clientId: null,
        lead: { is: { convertedClientId: null, deletedAt: null } },
      },
      select: { id: true, leadId: true },
    });

    let enqueued = 0;
    const skipped: Record<string, number> = {};
    const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);

    for (const thread of threads) {
      // 2) Latest INBOUND text message on this thread — the one we'd answer.
      const latestInbound = await this.prisma.whatsAppMessage.findFirst({
        where: { threadId: thread.id, direction: 'INBOUND', type: 'TEXT' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, body: true },
      });
      if (!latestInbound || !(latestInbound.body ?? '').trim()) {
        bump('no-text-inbound');
        continue;
      }

      // 3) If a human OUTBOUND landed after that latest inbound → human
      //    already replied, skip.
      const humanReplyAfter = await this.prisma.whatsAppMessage.findFirst({
        where: {
          threadId: thread.id,
          direction: 'OUTBOUND',
          sentByEmployeeId: { not: null },
          createdAt: { gt: latestInbound.createdAt },
        },
        select: { id: true },
      });
      if (humanReplyAfter) {
        bump('human-already-replied');
        continue;
      }

      // 4) Already processed by AI (any mode)? Skip — unique constraint on
      //    ai.runs.inboundMessageId would block the duplicate anyway.
      const existingRun = await this.prisma.aiRun.findUnique({
        where: { inboundMessageId: latestInbound.id },
        select: { id: true },
      });
      if (existingRun) {
        bump('already-processed');
        continue;
      }

      // 5) Paid client gate (processing or finance) is checked inside the
      //    orchestrator at fire-time, so we don't pre-filter here.

      await this.aiReplyQueue.add(
        'reply',
        {
          inboundMessageId: latestInbound.id,
          threadId: thread.id,
          body: latestInbound.body!,
        },
        {
          jobId: `ai-${latestInbound.id}`,
          // Small stagger so 100 backfills don't fire 100 OpenAI calls in 1s.
          delay: 2_000 + enqueued * 1_500,
          attempts: 2,
          removeOnComplete: { age: 3600, count: 500 },
          removeOnFail: { age: 24 * 3600, count: 500 },
        },
      );
      enqueued++;
    }

    return {
      scanned: threads.length,
      enqueued,
      skipped,
      note:
        'Jobs are staggered with a 1.5s gap to stay under OpenAI rate limits. ' +
        'Each job re-checks every guard at fire-time (paid client, human-active, ' +
        'aiDisabled, newer-inbound), so ineligible threads are dropped there.',
    };
  }
}
