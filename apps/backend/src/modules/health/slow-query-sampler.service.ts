import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Samples pg_stat_activity for queries that are ALREADY running long, and logs
 * them with a wall-clock timestamp.
 *
 * Why this exists: an RCA found ~30 query shapes with single executions of
 * 60-117s (against a 120s statement_timeout) spread across unrelated tables —
 * the "the app just froze" reports. `pg_stat_statements` records *that* a
 * statement was slow but never *when*, so those episodes can't be correlated to
 * backups, checkpoints, crons, deploys or CPU throttling.
 *
 * The obvious tool, `log_min_duration_statement`, is not available: it is a
 * superuser-context parameter, and on hosted Supabase the `postgres` role is
 * granted session-level SET but NOT `ALTER DATABASE ... SET` (verified:
 * 42501 permission denied). The dashboard's Custom Postgres Config is a paid
 * tier. So we sample from the application side instead — no DB privileges, no
 * plan upgrade, no restart, and the output lands in the logs we already have.
 *
 * Trade-off, stated plainly: a 10s sampling interval cannot see a stall shorter
 * than ~10s. That is deliberate and sufficient — we are hunting 60-117s events.
 *
 * Cost is negligible: pg_stat_activity is an in-memory view, the query is
 * filtered server-side and returns ~0 rows in the normal case.
 *
 * Disable with SLOW_QUERY_SAMPLER_ENABLED=false.
 * Tune the threshold with SLOW_QUERY_SAMPLER_THRESHOLD_MS (default 5000).
 */
@Injectable()
export class SlowQuerySamplerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SlowQuerySamplerService.name);
  private static readonly INTERVAL_MS = 10_000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  /**
   * Queries already reported, keyed by pid + query_start. A 90s stall would
   * otherwise be logged ~9 times. We log it once when first seen, then once
   * more when it clears (with its true total duration), which is the number
   * that actually matters.
   */
  private readonly seen = new Map<string, { firstSeenMs: number; query: string }>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.SLOW_QUERY_SAMPLER_ENABLED === 'false') {
      this.log.log('Slow-query sampler disabled (SLOW_QUERY_SAMPLER_ENABLED=false).');
      return;
    }
    // Start after boot so it never competes with startup connection setup.
    this.bootTimer = setTimeout(() => void this.tick(), 30_000);
    this.timer = setInterval(() => void this.tick(), SlowQuerySamplerService.INTERVAL_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
    this.log.log(
      `Slow-query sampler armed: every ${SlowQuerySamplerService.INTERVAL_MS / 1000}s, threshold ${this.thresholdMs()}ms.`,
    );
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private thresholdMs(): number {
    const raw = parseInt(process.env.SLOW_QUERY_SAMPLER_THRESHOLD_MS ?? '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const thresholdSec = this.thresholdMs() / 1000;

      // Cast interval -> text: Prisma cannot deserialise Postgres `interval`.
      // Exclude our own backend pid so the sampler can never report itself.
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          pid: number;
          runtime_ms: number;
          state: string | null;
          wait_event_type: string | null;
          wait_event: string | null;
          application_name: string | null;
          query: string;
          query_start_txt: string;
        }>
      >(`
        SELECT pid,
               (EXTRACT(EPOCH FROM (now() - query_start)) * 1000)::int AS runtime_ms,
               state,
               wait_event_type,
               wait_event,
               application_name,
               LEFT(query, 300) AS query,
               query_start::text AS query_start_txt
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state <> 'idle'
          AND query_start IS NOT NULL
          AND now() - query_start > interval '${thresholdSec} seconds'
        ORDER BY query_start ASC
        LIMIT 20
      `);

      const nowMs = Date.now();
      const activeKeys = new Set<string>();

      for (const r of rows) {
        const key = `${r.pid}:${r.query_start_txt}`;
        activeKeys.add(key);
        if (this.seen.has(key)) continue; // already reported; wait for it to clear
        this.seen.set(key, { firstSeenMs: nowMs, query: r.query });

        // Snapshot the whole instance at the moment of the stall — a stall is
        // usually a symptom, and what ELSE was happening is the actual clue.
        const ctx = await this.instanceContext().catch(() => null);
        this.log.warn(
          `SLOW QUERY DETECTED pid=${r.pid} running=${r.runtime_ms}ms ` +
            `state=${r.state ?? '-'} wait=${r.wait_event_type ?? '-'}/${r.wait_event ?? '-'} ` +
            `app=${r.application_name || '-'}` +
            (ctx ? ` | instance: ${ctx}` : '') +
            ` | sql=${r.query.replace(/\s+/g, ' ').trim()}`,
        );
      }

      // Anything previously reported that is no longer running has finished —
      // log its total observed duration, which is the headline number.
      for (const [key, info] of this.seen) {
        if (activeKeys.has(key)) continue;
        const heldMs = nowMs - info.firstSeenMs;
        this.log.warn(
          `SLOW QUERY CLEARED pid=${key.split(':')[0]} observed_for>=${heldMs}ms ` +
            `(first seen at >=${this.thresholdMs()}ms, so true duration >= ${this.thresholdMs() + heldMs}ms) ` +
            `| sql=${info.query.replace(/\s+/g, ' ').trim().slice(0, 160)}`,
        );
        this.seen.delete(key);
      }

      // Safety valve: never let the map grow without bound if something odd
      // keeps a key alive (e.g. a query_start that never changes).
      if (this.seen.size > 200) this.seen.clear();
    } catch (e) {
      // Never let diagnostics take the app down or spam on every tick.
      this.log.debug(`sampler tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** One-line snapshot of instance-wide pressure at the time of a stall. */
  private async instanceContext(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ total: number; active: number; idle_txn: number; waiting: number }>
    >(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE state = 'active')::int AS active,
             count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_txn,
             count(*) FILTER (WHERE wait_event_type IS NOT NULL
                                AND wait_event_type <> 'Client')::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    const r = rows[0];
    return r
      ? `conns=${r.total} active=${r.active} idleInTxn=${r.idle_txn} waitingOnNonClient=${r.waiting}`
      : 'unavailable';
  }
}
