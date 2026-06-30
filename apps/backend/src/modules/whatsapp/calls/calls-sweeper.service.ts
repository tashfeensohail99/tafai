import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WhatsAppCallsService } from './calls.service';

/**
 * Thin interval driver for WhatsAppCallsService.sweepStaleCalls(). Mirrors the
 * existing onModuleInit + setInterval sweeper pattern (sla-sweeper, expiry-sweeper)
 * — no @nestjs/schedule. Every 30s it expires stale RINGING rows and terminates
 * ANSWERED calls whose client heartbeat has gone silent (crashed tab/app), so a
 * call can never linger as a zombie. Disable with CALLS_SWEEPER_ENABLED=false.
 */
@Injectable()
export class CallsSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CallsSweeperService.name);
  private static readonly INTERVAL_MS = 30_000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly calls: WhatsAppCallsService) {}

  onModuleInit(): void {
    if (process.env.CALLS_SWEEPER_ENABLED === 'false') {
      this.log.log('Calls sweeper disabled (CALLS_SWEEPER_ENABLED=false).');
      return;
    }
    // First sweep 60s after boot (lets the telemetry migration land first), then
    // every 30s. unref() so the timers never hold the process open.
    this.bootTimer = setTimeout(() => void this.tick(), 60_000);
    this.timer = setInterval(() => void this.tick(), CallsSweeperService.INTERVAL_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.calls.sweepStaleCalls();
    } catch (e) {
      // Tolerates the telemetry columns not existing yet (pre-migration).
      this.log.warn(`call sweep skipped: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
