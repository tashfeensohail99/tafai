import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Bounds the audit_logs table on a daily schedule so the high-volume
 * capture-by-default rows don't grow without limit, while the
 * compliance-critical events are kept long:
 *   - LOW / MEDIUM  → kept AUDIT_RETENTION_LOW_DAYS  (default 90)
 *   - HIGH          → kept AUDIT_RETENTION_HIGH_DAYS (default 365)
 *   - CRITICAL      → NEVER auto-deleted
 *   - null severity → NEVER touched (legacy + specific service-logged rows)
 *
 * Deletes in capped batches off a setInterval (mirrors the sla / expiry /
 * attendance sweeper pattern — no extra scheduler dependency) so a backlog can
 * never produce one giant statement. Idempotent; a no-op once the tail is
 * trimmed.
 */
@Injectable()
export class AuditRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AuditRetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
  private static readonly BATCH = 5000;

  private readonly lowMediumDays = Number(
    process.env.AUDIT_RETENTION_LOW_DAYS ?? 90,
  );
  private readonly highDays = Number(process.env.AUDIT_RETENTION_HIGH_DAYS ?? 365);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // First pass staggered past boot, then daily.
    setTimeout(
      () =>
        void this.prune().catch((e) =>
          this.log.error(`audit retention failed: ${(e as Error).message}`),
        ),
      300_000,
    );
    this.timer = setInterval(() => {
      void this.prune().catch((e) =>
        this.log.error(`audit retention failed: ${(e as Error).message}`),
      );
    }, AuditRetentionService.INTERVAL_MS);
    this.log.log(
      `Audit retention started (daily; LOW/MEDIUM ${this.lowMediumDays}d, HIGH ${this.highDays}d, CRITICAL kept)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async prune(): Promise<void> {
    if (this.running) return; // never overlap a slow prune with the next tick
    this.running = true;
    try {
      const now = Date.now();
      const lowCut = new Date(now - this.lowMediumDays * 86_400_000);
      const highCut = new Date(now - this.highDays * 86_400_000);
      const a = await this.deleteOlderThan(
        [AuditSeverity.LOW, AuditSeverity.MEDIUM],
        lowCut,
      );
      const b = await this.deleteOlderThan([AuditSeverity.HIGH], highCut);
      if (a + b > 0) {
        this.log.log(
          `audit retention pruned ${a + b} row(s) (low/med:${a}, high:${b})`,
        );
      }
    } finally {
      this.running = false;
    }
  }

  /** Delete rows of the given severities older than `cutoff`, in capped batches. */
  private async deleteOlderThan(
    severities: AuditSeverity[],
    cutoff: Date,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where: { severity: { in: severities }, createdAt: { lt: cutoff } },
        select: { id: true },
        take: AuditRetentionService.BATCH,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);
      // Delete inside a tx that opts in to the append-only trigger's purge
      // gate (SET LOCAL is transaction-scoped). This retention job is the ONLY
      // sanctioned delete path; every other UPDATE/DELETE on audit_logs is
      // blocked at the DB level (see migration audit_logs_append_only). The SET
      // is a harmless no-op if the trigger isn't present yet.
      const count = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL audit.allow_purge = 'on'");
        const res = await tx.auditLog.deleteMany({ where: { id: { in: ids } } });
        return res.count;
      });
      total += count;
      if (rows.length < AuditRetentionService.BATCH) break;
    }
    return total;
  }
}
