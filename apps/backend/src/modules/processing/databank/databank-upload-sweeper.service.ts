import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DatabankUploadStatus, DatabankUploadStrategy, Prisma, type DatabankUpload } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { extractRolesAndPermissions, type RequestUser } from '../../../common/types/auth.types';
import { StorageService } from '../../storage/storage.service';
import { COMPLETING_STALE_MS, DatabankUploadService, mapLimit } from './databank-upload.service';

/**
 * Background sweeper for resumable databank uploads (Databank Phase 1 —
 * docs/databank-phase1-resumable-uploads.md §5). It is the safety net that
 * makes the upload state machine converge when nobody is at the keyboard.
 * Each pass, within a time budget, most urgent first:
 *
 *  1. PARKED / dead completions (COMPLETING, claim older than 15 min — a crash,
 *     a deploy, or a parked error): finish them, well before R2's 7-day
 *     auto-abort of the multipart upload would destroy the bytes.
 *  2. EXPIRED uploads (UPLOADING past their 6-day resume deadline): first try to
 *     FINISH them — a crashed tab can leave a file whose bytes are all in R2 but
 *     that was never completed; recording it beats deleting it. Only when
 *     finalize proves parts are missing is the session aborted and freed.
 *  3. PENDING CLEANUP: ABORTED / FAILED sessions whose R2 side isn't freed yet,
 *     and COMPLETED twin sessions still holding redundant bytes.
 *  4. Daily: purge terminal sessions older than 30 days, and — only where
 *     DATABANK_UPLOAD_RECONCILE_ENABLED=true — abort R2 multipart uploads older
 *     than 24 h that the DB doesn't know (an init that crashed between starting
 *     the R2 upload and recording it).
 *
 * Every step DRAINS its whole backlog with keyset paging (each row at most once
 * per pass) and bounded concurrency, so a large abandoned Drive-folder drop
 * can't starve a fully uploaded file of rescue before R2's deadline.
 *
 * Every finish runs through DatabankUploadService.finalize with the CREATOR's
 * CURRENT access (active account + a databank write permission + scope), so a
 * revoked user's upload is cancelled on this path exactly as on theirs.
 *
 * Safe with several instances: every state change is a compare-and-set, R2
 * aborts & deletes are idempotent. A pass stuck on a hung storage call is
 * superseded after twice the budget (duplicate work is harmless under CAS).
 * Kill-switch: DATABANK_UPLOAD_SWEEPER_ENABLED=false.
 */
@Injectable()
export class DatabankUploadSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DatabankUploadSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private passSeq = 0;
  private passStartedAt = 0;
  private lastDailyAt = 0;
  /** Wall clock for the pass budget / watchdog (overridable in tests). */
  clock: () => number = () => Date.now();

  static readonly INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
  static readonly PASS_BUDGET_MS = 20 * 60 * 1000; // leave room before the next tick
  static readonly DAILY_EVERY_MS = 24 * 60 * 60 * 1000;
  static readonly ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000; // never race a live init
  static readonly RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // purge settled sessions after 30 days
  static readonly BATCH = 100;
  static readonly FINALIZE_CONCURRENCY = 4;
  static readonly CLEANUP_CONCURRENCY = 8;

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
    if (this.running) {
      const age = this.clock() - this.passStartedAt;
      if (age < 2 * DatabankUploadSweeperService.PASS_BUDGET_MS) return; // never overlap a live pass
      // A pass stuck on a hung storage call would otherwise stop the sweeper for
      // good on this instance. Supersede it (duplicate work is harmless: CAS).
      this.log.error(`upload sweep: previous pass stuck for ${Math.round(age / 60000)} min — starting a new one`);
    }
    const pass = ++this.passSeq;
    this.running = true;
    this.passStartedAt = this.clock();
    const deadline = this.passStartedAt + DatabankUploadSweeperService.PASS_BUDGET_MS;
    try {
      // Dev storage modes (local / supabase) never create direct uploads.
      if (!this.storage.supportsDirectUpload) return;
      const creators = new Map<string, Promise<RequestUser>>();
      const scopeChecks = new Map<string, Promise<unknown>>(); // per pass: revocation still bites next pass
      await this.finishParked(now, deadline, creators, scopeChecks);
      await this.finishOrExpire(now, deadline, creators, scopeChecks);
      await this.retryCleanup(now, deadline);
      if (now.getTime() - this.lastDailyAt >= DatabankUploadSweeperService.DAILY_EVERY_MS) {
        this.lastDailyAt = now.getTime();
        await this.purgeSettled(now);
        if (process.env.DATABANK_UPLOAD_RECONCILE_ENABLED === 'true') await this.reconcileOrphans(now);
      }
    } finally {
      if (this.passSeq === pass) this.running = false;
    }
  }

  /**
   * Visit every row a query yields ONCE, oldest first, in batches: keyset paging
   * on (sortField, id) so rows whose state didn't change are never re-read in
   * the same pass (no busy loop), within the pass deadline.
   */
  private async drain<K extends 'expiresAt' | 'completingAt' | 'updatedAt'>(
    where: Prisma.DatabankUploadWhereInput,
    sortField: K,
    concurrency: number,
    deadline: number,
    handle: (row: DatabankUpload) => Promise<void>,
  ): Promise<void> {
    let after: DatabankUpload | null = null;
    while (this.clock() < deadline) {
      const keyset: Prisma.DatabankUploadWhereInput = after
        ? {
            OR: [
              { [sortField]: { gt: after[sortField] } },
              { [sortField]: after[sortField], id: { gt: after.id } },
            ],
          }
        : {};
      // eslint-disable-next-line no-await-in-loop
      const batch = await this.prisma.databankUpload.findMany({
        where: { AND: [where, keyset] },
        orderBy: [{ [sortField]: 'asc' }, { id: 'asc' }],
        take: DatabankUploadSweeperService.BATCH,
      });
      if (!batch.length) return;
      // eslint-disable-next-line no-await-in-loop
      await mapLimit(batch, concurrency, async (row) => {
        if (this.clock() < deadline) await handle(row);
      });
      after = batch[batch.length - 1];
      if (batch.length < DatabankUploadSweeperService.BATCH) return;
    }
    this.log.warn('upload sweep: pass budget reached — the rest continues next pass');
  }

  /** 1. Parked / dead completions: finish them (creator's current access). */
  private async finishParked(
    now: Date,
    deadline: number,
    creators: Map<string, Promise<RequestUser>>,
    scopeChecks: Map<string, Promise<unknown>>,
  ): Promise<void> {
    let finished = 0;
    await this.drain(
      {
        status: DatabankUploadStatus.COMPLETING,
        completingAt: { lt: new Date(now.getTime() - COMPLETING_STALE_MS) },
      },
      'completingAt',
      DatabankUploadSweeperService.FINALIZE_CONCURRENCY,
      deadline,
      async (s) => {
        if ((await this.safeFinalize(s, creators, scopeChecks)) === 'completed') finished++;
      },
    );
    if (finished) this.log.log(`upload sweep: ${finished} parked completion(s) recorded`);
  }

  /** 2. UPLOADING past the resume deadline: finish it if every byte is there,
   *  otherwise cancel it and free its storage. */
  private async finishOrExpire(
    now: Date,
    deadline: number,
    creators: Map<string, Promise<RequestUser>>,
    scopeChecks: Map<string, Promise<unknown>>,
  ): Promise<void> {
    let finished = 0;
    let expired = 0;
    await this.drain(
      { status: DatabankUploadStatus.UPLOADING, expiresAt: { lt: now } },
      'expiresAt',
      DatabankUploadSweeperService.FINALIZE_CONCURRENCY,
      deadline,
      async (s) => {
        const res = await this.safeFinalize(s, creators, scopeChecks);
        if (res === 'completed') {
          finished++;
          return;
        }
        if (res !== 'missing-parts') return; // retry / in-progress / settled — next pass
        // finalize proved parts are missing and handed the session back to
        // UPLOADING (ListParts succeeded → nothing assembled): now expire it.
        const moved = await this.prisma.databankUpload.updateMany({
          where: { id: s.id, status: DatabankUploadStatus.UPLOADING, expiresAt: { lt: now } },
          data: { status: DatabankUploadStatus.ABORTED, failureReason: 'expired', completingAt: null },
        });
        if (moved.count !== 1) return;
        expired++;
        await this.uploads.cleanupStorage({ ...s, status: DatabankUploadStatus.ABORTED, updatedAt: now });
      },
    );
    if (finished || expired) {
      this.log.log(`upload sweep: ${finished} expired upload(s) recorded, ${expired} expired + freed`);
    }
  }

  /** 3. Storage still to free: ABORTED/FAILED sessions, and COMPLETED twins.
   *  Single-PUT rows still inside their URL lifetime are skipped (cleanup would
   *  only defer them) so they can't crowd the queue. */
  private async retryCleanup(now: Date, deadline: number): Promise<void> {
    const urlWindowStart = new Date(now.getTime() - this.storage.uploadUrlTtlSeconds * 1000);
    await this.drain(
      {
        r2CleanedAt: null,
        status: { in: [DatabankUploadStatus.ABORTED, DatabankUploadStatus.FAILED, DatabankUploadStatus.COMPLETED] },
        NOT: { strategy: DatabankUploadStrategy.SINGLE, updatedAt: { gt: urlWindowStart } },
      },
      'updatedAt',
      DatabankUploadSweeperService.CLEANUP_CONCURRENCY,
      deadline,
      (s) => this.uploads.cleanupStorage(s), // best-effort; never touches a referenced object
    );
  }

  /** 4a. Daily: delete settled session rows (nothing left to free) older than
   *  30 days — keeps databank_uploads from growing without bound. A file keeps
   *  its uploadSessionId as a plain id; nothing needs the session after this. */
  private async purgeSettled(now: Date): Promise<void> {
    const { count } = await this.prisma.databankUpload.deleteMany({
      where: {
        status: { in: [DatabankUploadStatus.COMPLETED, DatabankUploadStatus.ABORTED, DatabankUploadStatus.FAILED] },
        r2CleanedAt: { not: null },
        updatedAt: { lt: new Date(now.getTime() - DatabankUploadSweeperService.RETENTION_MS) },
      },
    });
    if (count) this.log.log(`upload sweep: purged ${count} settled session row(s) older than 30 days`);
  }

  /** 4b. Daily (opt-in): abort R2 multipart uploads the DB doesn't know or
   *  already gave up on — older than 24 h so a just-started init is never
   *  raced. OPT-IN because it acts on the whole bucket prefix: a deployment
   *  sharing the bucket with a different database (e.g. local dev pointed at
   *  prod storage) must never run it. Without it, R2's 7-day auto-abort cleans up. */
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
    scopeChecks: Map<string, Promise<unknown>>,
  ): Promise<string> {
    try {
      let creator = creators.get(s.createdByUserId);
      if (!creator) {
        creator = this.creatorAsUser(s.createdByUserId);
        creators.set(s.createdByUserId, creator);
      }
      const res = await this.uploads.finalize(s, { user: await creator, sweeper: true, scopeChecks });
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
