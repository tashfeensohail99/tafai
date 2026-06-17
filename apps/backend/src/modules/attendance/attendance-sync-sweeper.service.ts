import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AttendanceClient } from './attendance.client';
import { AttendanceService } from './attendance.service';

/**
 * Auto-sync attendance from the camera's raw detections on a schedule, so the
 * attendance board fills itself — no one has to press "Sync this day".
 *
 * Re-syncs today + yesterday every 15 minutes:
 *   - today  → keeps the board live as people are detected through the day
 *     (check-out = latest sighting, so it advances on each tick);
 *   - yesterday → captures late check-outs that happened after the previous
 *     evening's last tick, finalising the prior day.
 *
 * Idempotent: AttendanceService.syncFromEvents upserts and NEVER clobbers a
 * manual override. No-op when the camera API isn't configured. Mirrors the
 * existing setInterval/onModuleInit sweeper pattern (sla-sweeper, expiry-sweeper).
 */
@Injectable()
export class AttendanceSyncSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AttendanceSyncSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private static readonly INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

  constructor(
    private readonly attendance: AttendanceService,
    private readonly client: AttendanceClient,
  ) {}

  onModuleInit(): void {
    // First pass shortly after boot (staggered past startup), then every 15 min.
    setTimeout(
      () => void this.sweep().catch((e) => this.log.error(`attendance auto-sync failed: ${(e as Error).message}`)),
      120_000,
    );
    this.timer = setInterval(() => {
      void this.sweep().catch((e) => this.log.error(`attendance auto-sync failed: ${(e as Error).message}`));
    }, AttendanceSyncSweeperService.INTERVAL_MS);
    this.log.log('Attendance auto-sync started (15m interval, events bridge)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    if (this.running) return; // never overlap a slow sweep with the next tick
    if (!this.client.configured) return; // camera API not set up → nothing to pull
    this.running = true;
    try {
      const now = Date.now() + 5 * 3600 * 1000; // PKT
      const today = new Date(now).toISOString().slice(0, 10);
      const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
      const r = await this.attendance.syncFromEvents({ from: yesterday, to: today }, 'system');
      if (r.imported > 0) {
        this.log.log(`attendance auto-sync: ${r.imported} record(s) from ${r.seen} detected (${yesterday}..${today})`);
      }
    } finally {
      this.running = false;
    }
  }
}
