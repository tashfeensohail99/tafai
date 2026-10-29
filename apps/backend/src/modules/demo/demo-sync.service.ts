import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { demoLivePhoneNumberIds, isDemoMode } from '../../common/demo-mode';
import { protectedUserIds } from './demo.constants';
import { DemoLeakChecker, type LeakReport } from './leak-check';
import { maskerFromEnv } from './masking';
import { DemoSyncEngine, poolFromUrl } from './sync/engine';
import { DEMO_SYNC_RULES } from './sync/rules';
import type { SyncResult } from './sync/types';

/**
 * Runs the production → demo mirror inside the demo backend.
 *
 *  DEMO_SYNC_ENABLED=true               start the timer (else on-demand only)
 *  DEMO_SYNC_SOURCE_DATABASE_URL        READ-ONLY production role (demo_reader)
 *  DATABASE_URL / DIRECT_URL            the demo database (target)
 *  DEMO_SYNC_INTERVAL_MINUTES=3         incremental run cadence
 *  DEMO_SYNC_FULL_EVERY_MINUTES=60      how often a run is a FULL run (prunes
 *                                       rows deleted in prod and overwrites
 *                                       prospect edits in incremental tables)
 *  DEMO_MASK_SALT                       secret salt for the masker
 */
@Injectable()
export class DemoSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DemoSyncService.name);
  private source: Pool | null = null;
  private target: Pool | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<SyncResult> | null = null;
  private lastFullAt = 0;
  private lastResult: SyncResult | null = null;
  private lastLeak: LeakReport | null = null;

  get enabled(): boolean {
    return String(process.env.DEMO_SYNC_ENABLED ?? '').toLowerCase() === 'true';
  }

  get configured(): boolean {
    return !!process.env.DEMO_SYNC_SOURCE_DATABASE_URL && !!process.env.DEMO_MASK_SALT;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      if (isDemoMode()) this.log.log('demo sync timer disabled (DEMO_SYNC_ENABLED != true); on-demand only');
      return;
    }
    if (!this.configured) {
      this.log.error('DEMO_SYNC_ENABLED=true but DEMO_SYNC_SOURCE_DATABASE_URL / DEMO_MASK_SALT are missing — sync will not run');
      return;
    }
    const intervalMs = Math.max(1, Number(process.env.DEMO_SYNC_INTERVAL_MINUTES ?? 3)) * 60_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    setTimeout(() => void this.tick(), 20_000).unref();
    this.log.log(`demo sync timer started: every ${intervalMs / 60_000} min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    void this.source?.end();
    void this.target?.end();
  }

  private async tick(): Promise<void> {
    const fullEveryMs = Math.max(5, Number(process.env.DEMO_SYNC_FULL_EVERY_MINUTES ?? 360)) * 60_000;
    if (!this.lastFullAt) {
      // Survive restarts: the last completed full run is recorded on the target.
      try {
        const { target } = this.pools();
        const row = await target.query<{ at: string | null }>(`SELECT max("finishedAt")::text AS at FROM demo_sync.runs WHERE "isFull" AND ok`);
        if (row.rows[0]?.at) this.lastFullAt = new Date(row.rows[0].at).getTime();
      } catch {
        // first run ever: no state yet
      }
    }
    const full = Date.now() - this.lastFullAt >= fullEveryMs;
    try {
      await this.runNow({ full });
    } catch (err) {
      this.log.error(`demo sync tick failed: ${(err as Error).message}`);
    }
  }

  private pools(): { source: Pool; target: Pool } {
    if (!this.configured) throw new Error('demo sync is not configured (DEMO_SYNC_SOURCE_DATABASE_URL / DEMO_MASK_SALT)');
    this.source ??= poolFromUrl(process.env.DEMO_SYNC_SOURCE_DATABASE_URL!, { max: 3, readOnly: true, statementTimeoutMs: 600_000 });
    const targetUrl = process.env.DEMO_SYNC_TARGET_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
    if (!targetUrl) throw new Error('no target database url (DATABASE_URL)');
    this.target ??= poolFromUrl(targetUrl, { max: 6 });
    return { source: this.source, target: this.target };
  }

  /** Run a sync now. Concurrent callers share the in-flight run. */
  runNow(opts: { full?: boolean; tables?: string[]; limit?: number; dryRun?: boolean } = {}): Promise<SyncResult> {
    if (this.running) return this.running;
    const { source, target } = this.pools();
    const engine = new DemoSyncEngine(source, target, maskerFromEnv(), DEMO_SYNC_RULES);
    const started = Date.now();
    this.log.log(`demo sync starting (${opts.full ? 'FULL' : 'incremental'}${opts.tables ? ` tables=${opts.tables.join(',')}` : ''})`);
    this.running = engine
      .run({
        full: !!opts.full,
        tables: opts.tables,
        limit: opts.limit,
        dryRun: opts.dryRun,
        livePhoneNumberIds: demoLivePhoneNumberIds(),
        protectedUserIds: protectedUserIds(),
        log: (m) => this.log.log(`[sync] ${m}`),
      })
      .then((res) => {
        this.lastResult = res;
        if (opts.full && !opts.tables && !opts.limit && !opts.dryRun) this.lastFullAt = Date.now();
        const totals = res.tables.reduce((a, t) => ({ read: a.read + t.read, written: a.written + t.written, pruned: a.pruned + t.pruned }), { read: 0, written: 0, pruned: 0 });
        this.log.log(`demo sync ${res.ok ? 'ok' : 'FINISHED WITH ERRORS'}: read=${totals.read} written=${totals.written} pruned=${totals.pruned} in ${Date.now() - started}ms`);
        return res;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async leakCheck(): Promise<LeakReport> {
    const { source, target } = this.pools();
    const keep = (process.env.DEMO_STAFF_KEEP ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const checker = new DemoLeakChecker(source, target, {
      livePhoneNumberIds: demoLivePhoneNumberIds(),
      allowEmails: keep,
      log: (m) => this.log.log(`[leak-check] ${m}`),
    });
    const report = await checker.run();
    this.lastLeak = report;
    this.log[report.ok ? 'log' : 'error'](`leak check ${report.ok ? 'PASSED' : `FAILED with ${report.findings.length} finding(s)`} (${report.scannedRows} rows, ${report.ms}ms)`);
    return report;
  }

  async status(): Promise<{
    demoMode: boolean;
    syncEnabled: boolean;
    configured: boolean;
    running: boolean;
    lastResult: SyncResult | null;
    lastLeakCheck: LeakReport | null;
    state: Array<Record<string, unknown>>;
    recentRuns: Array<Record<string, unknown>>;
  }> {
    let state: Array<Record<string, unknown>> = [];
    let recentRuns: Array<Record<string, unknown>> = [];
    if (this.configured) {
      try {
        const { target } = this.pools();
        state = (await target.query(`SELECT * FROM demo_sync.state ORDER BY "table"`)).rows;
        recentRuns = (await target.query(`SELECT id, "startedAt", "finishedAt", "isFull", ok FROM demo_sync.runs ORDER BY id DESC LIMIT 20`)).rows;
      } catch {
        // state tables appear after the first run
      }
    }
    return {
      demoMode: isDemoMode(),
      syncEnabled: this.enabled,
      configured: this.configured,
      running: !!this.running,
      lastResult: this.lastResult,
      lastLeakCheck: this.lastLeak ? { ...this.lastLeak, findings: this.lastLeak.findings.slice(0, 50) } : null,
      state,
      recentRuns,
    };
  }
}
