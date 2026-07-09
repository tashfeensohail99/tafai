import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Bounds `whatsapp.webhook_events`, which stores the RAW Meta payload of every
 * inbound webhook and was never pruned.
 *
 * It had grown to ~363k rows / 490MB — 42% of the whole database — which made
 * `INSERT INTO webhook_events` average 2.1s (the single largest consumer of DB
 * time at ~11%), because each insert must maintain 65MB of indexes and TOAST a
 * JSON blob. The rows are a debug/audit trail: the queue processor reads the
 * event back BY ID to process it and stamps `processedAt`, after which the row
 * has no operational use. Nothing keys off it for idempotency (there is no
 * unique constraint on `signature`), and no queue job survives the retention
 * window, so deleting past the cutoff is safe.
 *
 * Deletes in capped batches off a setInterval (mirrors AuditRetentionService and
 * the sla/expiry sweepers — no extra scheduler dependency). MAX_PER_RUN keeps a
 * large backlog from becoming one delete storm on an already-loaded database;
 * the tail drains over successive days. Idempotent, and a no-op once trimmed.
 *
 * Env:
 *   WHATSAPP_WEBHOOK_RETENTION_DAYS    (default 30)
 *   WHATSAPP_WEBHOOK_RETENTION_ENABLED ('false' to disable)
 */
@Injectable()
export class WebhookEventRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(WebhookEventRetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
  private static readonly BATCH = 5_000;
  /** Cap per run so a big backlog drains over days, never in one burst. */
  private static readonly MAX_PER_RUN = 50_000;

  private readonly retentionDays = Number(
    process.env.WHATSAPP_WEBHOOK_RETENTION_DAYS ?? 30,
  );
  private readonly enabled =
    process.env.WHATSAPP_WEBHOOK_RETENTION_ENABLED !== 'false';

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.log.warn('Webhook-event retention DISABLED (kill-switch)');
      return;
    }
    // Staggered well past boot so it never competes with startup work.
    setTimeout(
      () =>
        void this.prune().catch((e) =>
          this.log.error(`webhook retention failed: ${(e as Error).message}`),
        ),
      600_000,
    );
    this.timer = setInterval(() => {
      void this.prune().catch((e) =>
        this.log.error(`webhook retention failed: ${(e as Error).message}`),
      );
    }, WebhookEventRetentionService.INTERVAL_MS);
    this.log.log(
      `Webhook-event retention started (daily; keeping ${this.retentionDays}d)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Delete events older than the retention window, in capped batches. */
  async prune(): Promise<number> {
    if (this.running) return 0; // never overlap a slow prune with the next tick
    this.running = true;
    try {
      const cutoff = new Date(
        Date.now() - this.retentionDays * 24 * 60 * 60 * 1000,
      );
      let total = 0;
      for (;;) {
        if (total >= WebhookEventRetentionService.MAX_PER_RUN) {
          this.log.log(
            `webhook retention hit the ${WebhookEventRetentionService.MAX_PER_RUN}-row cap; resuming next run`,
          );
          break;
        }
        const rows = await this.prisma.whatsAppWebhookEvent.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: WebhookEventRetentionService.BATCH,
        });
        if (rows.length === 0) break;
        const res = await this.prisma.whatsAppWebhookEvent.deleteMany({
          where: { id: { in: rows.map((r) => r.id) } },
        });
        total += res.count;
        if (rows.length < WebhookEventRetentionService.BATCH) break;
      }
      if (total > 0) {
        this.log.log(
          `webhook retention pruned ${total} event(s) older than ${this.retentionDays}d`,
        );
      }
      return total;
    } finally {
      this.running = false;
    }
  }
}
