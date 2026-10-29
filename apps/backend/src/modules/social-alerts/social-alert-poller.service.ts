import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SocialAlertService } from './social-alert.service';

/**
 * Polls for new company posts and fires staff engagement alerts. The master
 * on/off lives in the DB config (default OFF), so this timer runs harmlessly
 * until an admin enables alerts. Boot-delayed, non-overlapping, unref'd timers
 * cleared on shutdown — same shape as the engagement sweep. Hard-disable with
 * SOCIAL_ALERT_POLLER_ENABLED=false.
 */
@Injectable()
export class SocialAlertPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SocialAlertPollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly svc: SocialAlertService) {}

  private intervalMs(): number {
    const min = Number(process.env.SOCIAL_ALERT_POLL_INTERVAL_MIN ?? '10');
    const clamped = Number.isFinite(min) && min >= 2 ? Math.min(min, 120) : 10;
    return clamped * 60_000;
  }

  onModuleInit(): void {
    if (process.env.SOCIAL_ALERT_POLLER_ENABLED === 'false') {
      this.log.log('social post-alert poller disabled (SOCIAL_ALERT_POLLER_ENABLED=false)');
      return;
    }
    this.bootTimer = setTimeout(() => void this.tick(), 90_000);
    this.bootTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), this.intervalMs());
    this.timer.unref?.();
    this.log.log(`social post-alert poller scheduled (every ${this.intervalMs() / 60_000} min)`);
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.svc.runPoll();
    } catch (e) {
      this.log.error(`social post-alert poll failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
