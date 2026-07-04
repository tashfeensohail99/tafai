import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type CsvDripJob } from '../queues/queue-contracts';

// 6-min stagger ≈ 240 touch-1/day — under the 250/24h per-channel cap, so the
// backfill trickles out rather than bursting. The drip processor still enforces
// the cap (deferring any overflow) and chains touch-2 +40h.
const STAGGER_MS = Number(process.env.CSV_DRIP_BACKFILL_STAGGER_MS ?? 360_000);
const LIMIT = Math.floor(Number(process.env.CSV_DRIP_BACKFILL_LIMIT ?? 0)) || 0; // 0 = no limit

/**
 * One-shot backfill of the CSV auto-drip for EXISTING cold CSV leads — the ones
 * imported before the drip shipped that were never contacted (no reply, not
 * converted, not blocked, not already dripped). Deliberately OPT-IN via the
 * CSV_DRIP_BACKFILL env flag so it never fires on an ordinary deploy:
 *   - unset            → does nothing (no log, no send)
 *   - 'preview'        → logs the eligible COUNT only (no enqueue)
 *   - 'send'           → enqueues touch-1 for each eligible lead, staggered
 *
 * Idempotent: touch-1 jobId is `drip-<lead>-t1` (BullMQ dedups) and the drip
 * service skips any lead whose dripTouch1At is already set — so re-runs on later
 * boots find nothing new and never double-send. The flag can be left set safely,
 * though clearing it after the run is tidier. Marketing to cold numbers is a
 * WhatsApp number-quality risk; the daily cap + stagger + the drip's own
 * opt-out/blocked/recently-active guards are the protection.
 */
@Injectable()
export class CsvDripBackfillRunner implements OnApplicationBootstrap {
  private readonly log = new Logger(CsvDripBackfillRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.CSV_DRIP) private readonly dripQueue: Queue<CsvDripJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const mode = (process.env.CSV_DRIP_BACKFILL ?? '').trim().toLowerCase();
    if (mode !== 'send' && mode !== 'preview') return; // strictly opt-in

    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT l.id FROM crm.leads l
         WHERE l."deletedAt" IS NULL
           AND l."dripTouch1At" IS NULL
           AND l."convertedClientId" IS NULL
           AND l."blockedAt" IS NULL
           AND EXISTS (SELECT 1 FROM crm.lead_import_rows r WHERE r."leadId" = l.id AND r.outcome IN ('IMPORTED','DUPLICATE'))
           AND NOT EXISTS (SELECT 1 FROM whatsapp.threads t WHERE t."leadId" = l.id AND t."firstInboundAt" IS NOT NULL)
         ORDER BY l."createdAt" ASC
         ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ''}`,
      );
      const ids = rows.map((r) => r.id);
      this.log.log(
        `CSV drip backfill: ${ids.length} eligible cold CSV leads (mode=${mode}, stagger=${STAGGER_MS}ms, limit=${LIMIT || 'none'})`,
      );
      if (mode !== 'send') {
        this.log.log('CSV drip backfill: PREVIEW only — set CSV_DRIP_BACKFILL=send to enqueue.');
        return;
      }

      let enqueued = 0;
      for (let i = 0; i < ids.length; i++) {
        try {
          await this.dripQueue.add(
            'touch1',
            { leadId: ids[i], touch: 1 },
            { jobId: `drip-${ids[i]}-t1`, delay: i * STAGGER_MS },
          );
          enqueued += 1;
        } catch (e) {
          this.log.warn(`CSV drip backfill: enqueue failed for lead ${ids[i]}: ${(e as Error).message}`);
        }
      }
      this.log.log(
        `CSV drip backfill: enqueued ${enqueued}/${ids.length} touch-1 jobs (paced under the daily cap; touch-2 auto-chains +40h). Re-runs are safe no-ops — you may clear CSV_DRIP_BACKFILL now.`,
      );
    } catch (e) {
      this.log.warn(`CSV drip backfill failed: ${(e as Error).message}`);
    }
  }
}
