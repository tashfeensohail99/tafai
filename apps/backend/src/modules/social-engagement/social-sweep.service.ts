import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SocialEngagementService } from './social-engagement.service';

/**
 * Scheduled social-engagement sweep. Pulls recent FB/IG posts + comments and
 * passively verifies IG comments against the employee handle registry (and
 * resolves any pending FB claims). Mirrors MetaAdsSyncService's shape:
 * boot-delayed, non-overlapping, unref'd timers cleared on shutdown.
 *
 * Gentle cadence (default 3h) — comment verification is not time-critical and
 * the Graph API is rate-limited. No-ops quietly when no Meta token resolves,
 * so it costs nothing until the token + handles are configured. Disable with
 * SOCIAL_ENGAGEMENT_SWEEP_ENABLED=false.
 */
@Injectable()
export class SocialSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SocialSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly svc: SocialEngagementService) {}

  private intervalMs(): number {
    const min = Number(process.env.SOCIAL_ENGAGEMENT_SWEEP_INTERVAL_MIN ?? '180');
    const clamped = Number.isFinite(min) && min >= 15 ? Math.min(min, 1440) : 180;
    return clamped * 60_000;
  }

  onModuleInit(): void {
    if (process.env.SOCIAL_ENGAGEMENT_SWEEP_ENABLED === 'false') {
      this.log.log('social sweep disabled (SOCIAL_ENGAGEMENT_SWEEP_ENABLED=false)');
      return;
    }
    // First sweep ~2 min after boot (let the app settle), then on the interval.
    this.bootTimer = setTimeout(() => void this.tick(), 120_000);
    this.bootTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), this.intervalMs());
    this.timer.unref?.();
    this.log.log(`social sweep scheduled (every ${this.intervalMs() / 60_000} min)`);
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    try {
      await this.svc.runSweep();
    } catch (e) {
      this.log.error(`social sweep tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
