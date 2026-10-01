import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Retention sweeper for the databank trash (Databank P3). A soft delete stamps
 * deletedAt; this background pass PERMANENTLY removes items that have sat in the
 * trash longer than the retention window — hard-deleting the rows and freeing
 * their storage objects, the same logic as DatabankService.purgeFile /
 * purgeFolder but batched so a huge trash can't block a pass.
 *
 * SAFETY — auto-purge is OFF by default. It runs ONLY when
 * DATABANK_TRASH_RETENTION_DAYS is set to a positive integer; unset / 0 /
 * non-numeric keeps trash forever (until a manual purge). Kill-switch: the timer
 * is not even started when DATABANK_TRASH_SWEEPER_ENABLED=false.
 *
 * Each pass, within a time budget: free + hard-delete every TRASHED FILE older
 * than the window (batched, oldest first), then every TRASHED FOLDER older than
 * the window (its already-emptied subtree cascades via the FK). A trashed child's
 * deletedAt is never newer than its parent's — you can't delete into a trashed
 * folder — so cascading an old folder never removes a younger item. A
 * compare-and-set on deletedAt means a file RESTORED (its deletedAt cleared, and
 * reparented to a live folder) between the scan and the delete is never removed,
 * and its storage is freed only once the row is confirmed gone. Storage failures
 * are logged, never thrown (the orphan is reclaimed next pass).
 *
 * Mirrors DatabankUploadSweeperService: OnModuleInit/Destroy, unref'd timer, a
 * pass budget + stuck-pass watchdog, a Logger.
 */
@Injectable()
export class DatabankTrashSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DatabankTrashSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private passSeq = 0;
  private passStartedAt = 0;
  /** Wall clock for the pass budget / watchdog (overridable in tests). */
  clock: () => number = () => Date.now();

  static readonly INTERVAL_MS = 60 * 60 * 1000; // hourly — retention is a slow policy
  static readonly PASS_BUDGET_MS = 20 * 60 * 1000;
  static readonly BATCH = 100;
  static readonly DAY_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    if (process.env.DATABANK_TRASH_SWEEPER_ENABLED === 'false') {
      this.log.warn('Databank trash sweeper DISABLED (DATABANK_TRASH_SWEEPER_ENABLED=false)');
      return;
    }
    const tick = () => void this.sweep().catch((e) => this.log.error(`trash sweep failed: ${(e as Error).message}`));
    // First pass shortly after boot, then hourly.
    this.bootTimer = setTimeout(tick, 3 * 60 * 1000);
    this.timer = setInterval(tick, DatabankTrashSweeperService.INTERVAL_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
    const days = this.retentionDays();
    this.log.log(
      days
        ? `Databank trash sweeper started (hourly; retention ${days} day(s))`
        : 'Databank trash sweeper started (hourly; auto-purge OFF — set DATABANK_TRASH_RETENTION_DAYS to enable)',
    );
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
    this.bootTimer = null;
    this.timer = null;
  }

  /** The configured retention window in whole days, or null when auto-purge is
   *  OFF (unset, blank, non-integer, or <= 0 — the SAFE default). */
  private retentionDays(): number | null {
    const raw = process.env.DATABANK_TRASH_RETENTION_DAYS;
    if (raw === undefined || raw.trim() === '') return null;
    const days = Number(raw);
    if (!Number.isInteger(days) || days <= 0) return null;
    return days;
  }

  /** One pass. `now` is injectable for tests. Does NOTHING unless a positive
   *  retention window is configured. */
  async sweep(now: Date = new Date()): Promise<void> {
    const days = this.retentionDays();
    if (days === null) return; // auto-purge OFF — the default

    if (this.running) {
      const age = this.clock() - this.passStartedAt;
      if (age < 2 * DatabankTrashSweeperService.PASS_BUDGET_MS) return; // never overlap a live pass
      this.log.error(`trash sweep: previous pass stuck for ${Math.round(age / 60000)} min — starting a new one`);
    }
    const pass = ++this.passSeq;
    this.running = true;
    this.passStartedAt = this.clock();
    const deadline = this.passStartedAt + DatabankTrashSweeperService.PASS_BUDGET_MS;
    const cutoff = new Date(now.getTime() - days * DatabankTrashSweeperService.DAY_MS);
    try {
      const files = await this.purgeAgedFiles(cutoff, deadline);
      const folders = await this.purgeAgedFolders(cutoff, deadline);
      if (files || folders) {
        this.log.log(
          `trash sweep: purged ${files} file(s) + ${folders} folder(s) trashed before ${cutoff.toISOString()}`,
        );
      }
    } finally {
      if (this.passSeq === pass) this.running = false;
    }
  }

  /** Free + hard-delete trashed files older than `cutoff`, oldest first, in
   *  batches until drained or the budget runs out. */
  private async purgeAgedFiles(cutoff: Date, deadline: number): Promise<number> {
    let purged = 0;
    while (this.clock() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const batch = await this.prisma.databankFile.findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        orderBy: { deletedAt: 'asc' },
        take: DatabankTrashSweeperService.BATCH,
        select: { id: true, storageKey: true },
      });
      if (!batch.length) break;
      const ids = batch.map((f) => f.id);
      // Compare-and-set on deletedAt — a file restored since the scan is excluded.
      // eslint-disable-next-line no-await-in-loop
      await this.prisma.databankFile.deleteMany({
        where: { id: { in: ids }, deletedAt: { not: null, lt: cutoff } },
      });
      // Free storage ONLY for rows that are truly gone — a restored file (now
      // reparented to a live folder) survives the guarded delete and keeps its bytes.
      // eslint-disable-next-line no-await-in-loop
      const survivors = await this.prisma.databankFile.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const alive = new Set(survivors.map((s) => s.id));
      // eslint-disable-next-line no-await-in-loop
      await this.freeStorage(batch.filter((f) => !alive.has(f.id)).map((f) => f.storageKey));
      purged += ids.length - alive.size;
      if (batch.length < DatabankTrashSweeperService.BATCH) break;
    }
    return purged;
  }

  /** Hard-delete trashed folders older than `cutoff`. Their files were already
   *  freed by purgeAgedFiles; the FK cascade removes any nested trashed folder
   *  rows. Defensively frees any file still under a batch folder first, so a
   *  cascade can never orphan a storage object. */
  private async purgeAgedFolders(cutoff: Date, deadline: number): Promise<number> {
    let purged = 0;
    while (this.clock() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const batch = await this.prisma.databankFolder.findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        orderBy: { deletedAt: 'asc' },
        take: DatabankTrashSweeperService.BATCH,
        select: { id: true },
      });
      if (!batch.length) break;
      const ids = batch.map((f) => f.id);
      // eslint-disable-next-line no-await-in-loop
      const files = await this.prisma.databankFile.findMany({
        where: { folderId: { in: ids } },
        select: { storageKey: true },
      });
      if (files.length) {
        // eslint-disable-next-line no-await-in-loop
        await this.prisma.databankFile.deleteMany({ where: { folderId: { in: ids } } });
      }
      // eslint-disable-next-line no-await-in-loop
      const removed = await this.prisma.databankFolder.deleteMany({
        where: { id: { in: ids }, deletedAt: { not: null, lt: cutoff } },
      });
      // eslint-disable-next-line no-await-in-loop
      await this.freeStorage(files.map((f) => f.storageKey));
      purged += removed.count;
      if (batch.length < DatabankTrashSweeperService.BATCH) break;
    }
    return purged;
  }

  /** Best-effort storage free — AFTER the rows are gone. A failure is logged (the
   *  orphan is reclaimed next pass), never thrown. */
  private async freeStorage(storageKeys: string[]): Promise<void> {
    for (const key of storageKeys) {
      // eslint-disable-next-line no-await-in-loop
      await this.storage
        .delete(key)
        .catch((e) =>
          this.log.warn(`trash sweep: freeing ${key} failed (orphan left for next pass): ${(e as Error).message}`),
        );
    }
  }
}
