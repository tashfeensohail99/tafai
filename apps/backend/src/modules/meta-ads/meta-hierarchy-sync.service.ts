import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MetaHierarchyService } from './meta-hierarchy.service';

/**
 * Periodic Meta structure sync. Mirrors the campaign → ad-set → ad hierarchy
 * (names, delivery status, budgets) into the local tables every 6h so the
 * Marketing dashboard can browse structure and CTWA leads keep resolving their
 * ad-set/campaign, without an admin pressing "sync".
 *
 * Boots ~2.5 min after start — staggered behind the ad-spend sync (~90s) so the
 * two Marketing-API sweeps don't fire at the same instant. No-ops quietly when
 * `meta_ads` credentials are absent (costs nothing until wired up).
 */
@Injectable()
export class MetaHierarchySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MetaHierarchySyncService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private static readonly INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

  constructor(private readonly hierarchy: MetaHierarchyService) {}

  onModuleInit(): void {
    this.bootTimer = setTimeout(() => void this.tick(), 150_000);
    this.bootTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), MetaHierarchySyncService.INTERVAL_MS);
    this.timer.unref?.();
    this.log.log('Meta hierarchy sync scheduled (every 6h)');
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    try {
      const res = await this.hierarchy.syncHierarchy();
      if (res.skipped) this.log.debug?.(`hierarchy sync skipped: ${res.reason}`);
    } catch (e) {
      this.log.error(`hierarchy sync tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
