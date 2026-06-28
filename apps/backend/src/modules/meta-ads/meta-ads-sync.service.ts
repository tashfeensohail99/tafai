import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MetaAdsService } from './meta-ads.service';

/**
 * Periodic ad-spend sync. Pulls the trailing ~35 days of per-ad daily spend
 * from the Marketing API and upserts AdSpendDaily, so the leads dashboard's
 * CPL/CPA/ROAS stay current without an admin pressing "sync".
 *
 * Cadence is deliberately gentle (every 6h) — spend for past days only firms
 * up slightly after the fact, and Insights is rate-limited. No-ops quietly
 * when `meta_ads` credentials are not configured (so it costs nothing until
 * the admin wires up the ad account + token).
 */
@Injectable()
export class MetaAdsSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MetaAdsSyncService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private static readonly INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
  // Keep ~a quarter of daily spend so the dashboard's calendar range can look
  // back up to 3 months. Past days only firm up slightly, so re-syncing the
  // whole window each tick is cheap + idempotent.
  private static readonly TRAILING_DAYS = 92;

  constructor(private readonly ads: MetaAdsService) {}

  onModuleInit(): void {
    // First sync ~90s after boot (let the app settle), then every 6h. Both
    // timers are unref'd so they never pin a short-lived process / test, and
    // both are cleared on shutdown.
    this.bootTimer = setTimeout(() => void this.tick(), 90_000);
    this.bootTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), MetaAdsSyncService.INTERVAL_MS);
    this.timer.unref?.();
    this.log.log('Meta ad-spend sync scheduled (every 6h, trailing 35d)');
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    try {
      const res = await this.ads.syncSpend(MetaAdsSyncService.TRAILING_DAYS);
      if (res.skipped) {
        this.log.debug?.(`ad-spend sync skipped: ${res.reason}`);
      }
    } catch (e) {
      this.log.error(`ad-spend sync tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
