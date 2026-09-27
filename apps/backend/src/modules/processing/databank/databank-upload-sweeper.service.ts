import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DatabankUploadStatus, type DatabankUpload } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { extractRolesAndPermissions, type RequestUser } from '../../../common/types/auth.types';
import { StorageService } from '../../storage/storage.service';
import { COMPLETING_STALE_MS, DatabankUploadService } from './databank-upload.service';

/**
 * Background sweeper for resumable databank uploads (Databank Phase 1 —
 * docs/databank-phase1-resumable-uploads.md §5). It is the safety net that
 * makes the upload state machine converge when nobody is at the keyboard:
 *
 *  1. EXPIRED uploads (UPLOADING past their 6-day resume deadline): first try to
 *     FINISH them — a crashed tab can leave a file whose bytes are all in R2 but
 *     that was never completed; recording it beats deleting it. Only if parts are
 *     genuinely missing is the session aborted and its storage freed.
 *  2. PARKED / dead completions (COMPLETING, claim older than 15 min — a crash,
 *     a deploy, or a parked error): finish them, well before R2's 7-day
 *     auto-abort of the multipart upload would destroy the bytes.
 *  3. PENDING CLEANUP: ABORTED / FAILED sessions whose R2 side isn't freed yet,
 *     and COMPLETED twin sessions whose redundant bytes weren't freed.
 *  4. Once a day, ORPHAN R2 uploads (an init that crashed between starting the
 *     R2 upload and recording the session) older than 24 h are aborted.
 *
 * Every finish runs through DatabankUploadService.finalize with the CREATOR's
 * CURRENT access (active account + a databank write permission + scope), so a
 * revoked user's upload is cancelled on this path exactly as on theirs.
 *
 * Safe with several instances: every state change is a compare-and-set in
 * finalize / here, R2 aborts & deletes are idempotent, and `running` stops a
 * slow pass overlapping the next tick. Kill-switch: DATABANK_UPLOAD_SWEEPER_ENABLED=false.
 * Mirrors the setInterval pattern of DocumentExpirySweeperService.
 */
@Injectable()
export class DatabankUploadSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DatabankUploadSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastReconcileAt = 0;

  static readonly INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
  static readonly RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000; // orphan scan daily
  static readonly ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000; // never race a live init
  static readonly BATCH = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly uploads: DatabankUploadService,
  ) {}

  onModuleInit(): void {
    if (process.env.DATABANK_UPLOAD_SWEEPER_ENABLED === 'false') {
      this.log.warn('Databank upload sweeper DISABLED (DATABANK_UPLOAD_SWEEPER_ENABLED=false)');
      return;
    }
    const tick = () => void this.sweep().catch((e) => this.log.error(`upload sweep failed: ${(e as Error).message}`));
    // First pass shortly after boot (past migrations / startup), then every 30 min.
    this.bootTimer = setTimeout(tick, 2 * 60 * 1000);
    this.timer = setInterval(tick, DatabankUploadSweeperService.INTERVAL_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
    this.log.log('Databank upload sweeper started (30 min interval)');
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
    this.bootTimer = null;
    this.timer = null;
  }

  /** One pass. `now` is injectable for tests. */
  async sweep(now: Date = new Date()): Promise<void> {
    if (this.running) return; // never overlap a slow pass with the next tick
    this.running = true;
    try {
      // Dev storage modes (local / supabase) never create direct uploads.
      if (!this.storage.supportsDirectUpload) return;
      const creators = new Map<string, Promise<RequestUser>>();
      await this.finishOrExpire(now, creators);
      await this.finishParked(now, creators);
      await this.retryCleanup();
      if (now.getTime() - this.lastReconcileAt >= DatabankUploadSweeperService.RECONCILE_EVERY_MS) {
        await this.reconcileOrphans(now);
        this.lastReconcileAt = now.getTime();
      }
    } finally {
      this.running = false;
    }
  }

  /** 1. UPLOADING past the resume deadline: finish it if every byte is there,
   *  otherwise cancel it and free its storage. */
  private async finishOrExpire(now: Date, creators: Map<string, Promise<RequestUser>>): Promise<void> {
    const expired = await this.prisma.databankUpload.findMany({
      where: { status: DatabankUploadStatus.UPLOADING, expiresAt: { lt: now } },
      orderBy: { expiresAt: 'asc' },
      take: DatabankUploadSweeperService.BATCH,
    });
    let finished = 0;
    let expiredCount = 0;
    for (const s of expired) {
      // eslint-disable-next-line no-await-in-loop
      const res = await this.safeFinalize(s, creators);
      if (res === 'completed') {
        finished++;
        continue;
      }
      if (res !== 'missing-parts') continue; // retry / in-progress / settled — next tick
      // finalize proved parts are missing and handed the session back to
      // UPLOADING (ListParts succeeded → nothing assembled): now expire it.
      // eslint-disable-next-line no-await-in-loop
      const moved = await this.prisma.databankUpload.updateMany({
        where: { id: s.id, status: DatabankUploadStatus.UPLOADING, expiresAt: { lt: now } },
        data: { status: DatabankUploadStatus.ABORTED, failureReason: 'expired', completingAt: null },
      });
      if (moved.count !== 1) continue;
      expiredCount++;
      // eslint-disable-next-line no-await-in-loop
      await this.uploads.cleanupStorage({ ...s, status: DatabankUploadStatus.ABORTED, updatedAt: now });
    }
    if (finished || expiredCount) {
      this.log.log(`upload sweep: ${finished} expired upload(s) recorded, ${expiredCount} expired + freed`);
    }
  }

  /** 2. Parked / dead completions: finish them (creator's current access). */
  private async finishParked(now: Date, creators: Map<string, Promise<RequestUser>>): Promise<void> {
    const stale = await this.prisma.databankUpload.findMany({
      where: {
        status: DatabankUploadStatus.COMPLETING,
        completingAt: { lt: new Date(now.getTime() - COMPLETING_STALE_MS) },
      },
      orderBy: { completingAt: 'asc' },
      take: DatabankUploadSweeperService.BATCH,
    });
    let finished = 0;
    for (const s of stale) {
      // eslint-disable-next-line no-await-in-loop
      if ((await this.safeFinalize(s, creators)) === 'completed') finished++;
    }
    if (finished) this.log.log(`upload sweep: ${finished} parked completion(s) recorded`);
  }

  /** 3. Storage still to free: ABORTED/FAILED sessions, and COMPLETED twins. */
  private async retryCleanup(): Promise<void> {
    const pending = await this.prisma.databankUpload.findMany({
      where: {
        r2CleanedAt: null,
        status: { in: [DatabankUploadStatus.ABORTED, DatabankUploadStatus.FAILED, DatabankUploadStatus.COMPLETED] },
      },
      orderBy: { updatedAt: 'asc' },
      take: DatabankUploadSweeperService.BATCH,
    });
    for (const s of pending) {
      // eslint-disable-next-line no-await-in-loop
      await this.uploads.cleanupStorage(s); // best-effort; never touches a referenced object
    }
  }

  /** 4. Daily: abort R2 multipart uploads the DB doesn't know (or already gave
   *  up on) — older than 24 h so a just-started init is never raced. */
  private async reconcileOrphans(now: Date): Promise<void> {
    const cutoff = now.getTime() - DatabankUploadSweeperService.ORPHAN_MIN_AGE_MS;
    const inR2 = (await this.storage.listMultipartUploads('databank/')).filter(
      (u) => u.initiated && u.initiated.getTime() < cutoff,
    );
    if (!inR2.length) return;
    let aborted = 0;
    for (let i = 0; i < inR2.length; i += 500) {
      const chunk = inR2.slice(i, i + 500);
      // eslint-disable-next-line no-await-in-loop
      const known = await this.prisma.databankUpload.findMany({
        where: { r2UploadId: { in: chunk.map((u) => u.uploadId) } },
        select: { r2UploadId: true, status: true },
      });
      const live = new Set(
        known
          .filter((k) => k.status === DatabankUploadStatus.UPLOADING || k.status === DatabankUploadStatus.COMPLETING)
          .map((k) => k.r2UploadId),
      );
      for (const u of chunk) {
        if (live.has(u.uploadId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await this.storage
          .abortMultipartUpload(u.key, u.uploadId)
          .then(() => aborted++)
          .catch((e) => this.log.warn(`orphan abort ${u.uploadId} deferred: ${(e as Error).message}`));
      }
    }
    if (aborted) this.log.log(`upload sweep: ${aborted} orphan R2 upload(s) aborted`);
  }

  /** finalize with the creator's current access; never throws. */
  private async safeFinalize(
    s: DatabankUpload,
    creators: Map<string, Promise<RequestUser>>,
  ): Promise<string> {
    try {
      let creator = creators.get(s.createdByUserId);
      if (!creator) {
        creator = this.creatorAsUser(s.createdByUserId);
        creators.set(s.createdByUserId, creator);
      }
      const res = await this.uploads.finalize(s, { user: await creator, sweeper: true });
      return res.status;
    } catch (e) {
      this.log.warn(`upload sweep: finalize ${s.id} failed: ${(e as Error).message}`);
      return 'error';
    }
  }

  /**
   * The creator as a RequestUser with their CURRENT permissions (the same
   * derivation as login). An account that is gone or not ACTIVE gets no
   * permissions — finalize then treats the upload as access-revoked (cancel +
   * free), exactly as it would if that user retried complete themselves.
   */
  private async creatorAsUser(userId: string): Promise<RequestUser> {
    const u = await this.prisma.userAccount.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
      },
    });
    if (!u || u.status !== 'ACTIVE') {
      return { id: userId, email: u?.email ?? '', roles: [], permissions: [] };
    }
    const { roles, permissions } = extractRolesAndPermissions(u);
    return { id: u.id, email: u.email, roles, permissions };
  }
}
