import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
   *  batches until drained or the budget runs out. A file nested under a
   *  still-trashed folder is SKIPPED here — it shares that folder's retention
   *  clock and is cascaded + freed by purgeAgedFolders when the folder itself
   *  ages. Otherwise a file trashed individually BEFORE its folder (an OLDER
   *  deletedAt) would be reaped ahead of the still-restorable folder, silently
   *  losing it from a later restoreFolder (which restores the whole subtree as a
   *  unit). Only root files and files under a LIVE folder age on their own clock. */
  private async purgeAgedFiles(cutoff: Date, deadline: number): Promise<number> {
    let purged = 0;
    // folderId NULL (root) OR the folder is live — never a trashed folder.
    const notUnderTrashedFolder = { OR: [{ folderId: null }, { folder: { deletedAt: null } }] };
    while (this.clock() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const batch = await this.prisma.databankFile.findMany({
        where: { deletedAt: { not: null, lt: cutoff }, ...notUnderTrashedFolder },
        orderBy: { deletedAt: 'asc' },
        take: DatabankTrashSweeperService.BATCH,
        select: { id: true, storageKey: true },
      });
      if (!batch.length) break;
      const ids = batch.map((f) => f.id);
      // Capture the batch's version keys BEFORE the delete — the FK
      // version.fileId → file ON DELETE CASCADE removes version rows without
      // freeing their objects (P3-2 lifecycle invariant). A file is wholly gone or
      // wholly restored, so the survivor check at FILE level governs its versions too.
      // eslint-disable-next-line no-await-in-loop
      const versionRows = await this.prisma.databankFileVersion.findMany({
        where: { fileId: { in: ids } },
        select: { fileId: true, storageKey: true },
      });
      const versionKeysByFile = new Map<string, string[]>();
      for (const v of versionRows) {
        const arr = versionKeysByFile.get(v.fileId) ?? [];
        arr.push(v.storageKey);
        versionKeysByFile.set(v.fileId, arr);
      }
      // Compare-and-set on deletedAt AND re-check the folder: a file restored, or
      // newly nested under a folder trashed since the scan, is excluded (it then
      // ages with that folder).
      // eslint-disable-next-line no-await-in-loop
      await this.prisma.databankFile.deleteMany({
        where: { id: { in: ids }, deletedAt: { not: null, lt: cutoff }, ...notUnderTrashedFolder },
      });
      // Free storage ONLY for rows that are truly gone — a restored file (now
      // reparented to a live folder) survives the guarded delete and keeps its bytes.
      // eslint-disable-next-line no-await-in-loop
      const survivors = await this.prisma.databankFile.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const alive = new Set(survivors.map((s) => s.id));
      // For each file truly gone, free the DEDUPED union {file key} ∪ {its version
      // keys} — the current object appears in both the mirror and its version row.
      const freeKeys = batch
        .filter((f) => !alive.has(f.id))
        .flatMap((f) => [f.storageKey, ...(versionKeysByFile.get(f.id) ?? [])]);
      // eslint-disable-next-line no-await-in-loop
      await this.freeStorage([...new Set(freeKeys)]);
      purged += ids.length - alive.size;
      if (batch.length < DatabankTrashSweeperService.BATCH) break;
    }
    return purged;
  }

  /** Hard-delete trashed folders older than `cutoff`. purgeAgedFiles has already
   *  freed + removed every aged trashed FILE, and a trashed child is never newer
   *  than its parent, so by the time this runs an aged folder's subtree holds no
   *  files to orphan. The upload paths take FOR SHARE on their live destination
   *  (DatabankService.lockLiveDestinationFolder), so no LIVE file is ever stranded
   *  under a trashed folder either — the FK cascade below only ever removes
   *  trashed rows.
   *
   *  Deletes the aged ROOTS and lets the self-FK cascade clear their (trashed)
   *  subtree — folders AND files — in one shot. Two safeguards, no relocate:
   *   - a compare-and-set on deletedAt skips a folder RESTORED since the scan;
   *     restoreFolder reparents a restored subtree to the root, so it also leaves
   *     a trashed ancestor's cascade reach and is never swept with it. (The old
   *     relocate-live-files-to-root step is gone: it could yank a just-restored
   *     folder's live files to the root.)
   *   - before deleting, capture every trashed file in each root's FULL cascade
   *     reach (the recursive subtree, matching what Postgres cascades) and free
   *     the bytes of any the cascade truly removed — survivor-checked, so a file
   *     restored since the capture keeps both its row and its bytes. This closes
   *     the leak where the cascade reaches a descendant folder OUTSIDE the batch. */
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
      const rootIds = batch.map((f) => f.id);
      // The full set of folders the delete will remove: the roots plus ALL
      // descendants (any age) reachable through the parentFolderId self-FK — the
      // exact set Postgres cascades through — so the file capture below covers
      // every file the cascade can take, not just those directly under a root.
      // eslint-disable-next-line no-await-in-loop
      const reach = await this.prisma.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE sub AS (
          SELECT "id" FROM "processing"."databank_folders" WHERE "id" IN (${Prisma.join(rootIds)})
          UNION
          SELECT f."id" FROM "processing"."databank_folders" f JOIN sub ON f."parentFolderId" = sub."id"
        )
        SELECT "id" FROM sub`;
      const reachIds = reach.map((r) => r.id);
      // Trashed files anywhere in that reach — never a live/restored one (a
      // restored file is reparented to the root, out of this reach). Captured so
      // the cascade below can't orphan their storage objects.
      // eslint-disable-next-line no-await-in-loop
      const files = await this.prisma.databankFile.findMany({
        where: { folderId: { in: reachIds }, deletedAt: { not: null } },
        select: { id: true, storageKey: true },
      });
      // Capture those files' version keys BEFORE the delete — the FK cascade
      // (folders → files → versions) removes version rows without freeing objects.
      const fileIds = files.map((f) => f.id);
      // eslint-disable-next-line no-await-in-loop
      const versionRows = fileIds.length
        ? await this.prisma.databankFileVersion.findMany({
            where: { fileId: { in: fileIds } },
            select: { fileId: true, storageKey: true },
          })
        : [];
      const versionKeysByFile = new Map<string, string[]>();
      for (const v of versionRows) {
        const arr = versionKeysByFile.get(v.fileId) ?? [];
        arr.push(v.storageKey);
        versionKeysByFile.set(v.fileId, arr);
      }
      // Delete the aged roots; the FK cascade removes the rest of each (trashed)
      // subtree. Compare-and-set skips a root restored since the scan.
      // eslint-disable-next-line no-await-in-loop
      const removed = await this.prisma.databankFolder.deleteMany({
        where: { id: { in: rootIds }, deletedAt: { not: null, lt: cutoff } },
      });
      // Free storage ONLY for captured files now truly gone (a file restored
      // since the capture keeps both its row AND its bytes). Mirrors purgeAgedFiles.
      if (files.length) {
        // eslint-disable-next-line no-await-in-loop
        const survivors = new Set(
          (
            await this.prisma.databankFile.findMany({
              where: { id: { in: fileIds } },
              select: { id: true },
            })
          ).map((s) => s.id),
        );
        // The DEDUPED union {file key} ∪ {its version keys} for each file truly gone.
        const freeKeys = files
          .filter((f) => !survivors.has(f.id))
          .flatMap((f) => [f.storageKey, ...(versionKeysByFile.get(f.id) ?? [])]);
        // eslint-disable-next-line no-await-in-loop
        await this.freeStorage([...new Set(freeKeys)]);
      }
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
