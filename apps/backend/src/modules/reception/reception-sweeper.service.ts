import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReceptionService } from './reception.service';

/**
 * Periodic reception maintenance — mirrors CallsSweeperService (setInterval on
 * module init, unref'd so it never holds the process open, env-gated). Runs
 * ReceptionService.sweepStaleConsults(): releases stale unpaid bank transfers
 * that would otherwise hold the principal's calendar forever, recovers a payment
 * stranded in VERIFYING by a worker that died mid-verify, and fires the ~24h/2h
 * customer appointment reminders. Disable with RECEPTION_SWEEPER_ENABLED=false.
 */
@Injectable()
export class ReceptionSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReceptionSweeperService.name);
  private static readonly INTERVAL_MS = 5 * 60 * 1000; // every 5 min
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly reception: ReceptionService) {}

  onModuleInit(): void {
    if (process.env.RECEPTION_SWEEPER_ENABLED === 'false') {
      this.log.log('Reception sweeper disabled (RECEPTION_SWEEPER_ENABLED=false).');
      return;
    }
    this.bootTimer = setTimeout(() => void this.tick(), 90_000); // first pass 90s after boot
    this.timer = setInterval(() => void this.tick(), ReceptionSweeperService.INTERVAL_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap a pass
    this.running = true;
    try {
      await this.reception.sweepStaleConsults();
    } catch (e) {
      this.log.warn(`reception sweep skipped: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
