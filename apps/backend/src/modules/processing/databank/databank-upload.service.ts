import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DatabankFileSource,
  DatabankUploadStatus,
  DatabankUploadStrategy,
  Prisma,
  type DatabankUpload,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RequestUser } from '../../../common/types/auth.types';
import { StorageService, isNoSuchUploadError } from '../../storage/storage.service';
import { DatabankService } from './databank.service';
import {
  CompleteUploadsDto,
  InitUploadFileDto,
  InitUploadsDto,
  SignPartsDto,
} from './databank-upload.dto';
import {
  GiB,
  expectedPartBytes,
  exceedsUploadCap,
  planParts,
  resolveMaxUploadBytes,
  verifyParts,
  type UploadPlan,
} from './upload-plan';

/** Resume window: 6 days from start — inside R2's 7-day auto-abort of
 *  incomplete multipart uploads (counted from initiation). */
export const SESSION_TTL_MS = 6 * 24 * 60 * 60 * 1000;
/** A COMPLETING claim older than this is presumed dead (crash / deploy) and
 *  may be reclaimed — by the user retrying complete, or by the sweeper. */
export const COMPLETING_STALE_MS = 15 * 60 * 1000;
/** Part URLs handed out with init; the client tops up via uploads/:id/parts. */
const INIT_URL_BATCH = 64;
/** Parallel R2 calls when creating / resuming sessions in one init. */
const R2_CONCURRENCY = 8;
/** Parallel finalizes per complete request. */
const FINALIZE_CONCURRENCY = 6;

type Scope = { clientId: string | null; ownerUserId: string | null; storageFolder: string };
type PartUrl = { partNumber: number; url: string; headers?: Record<string, string> };
type ExistingFile = {
  id: string;
  fileName: string;
  folderId: string | null;
  folderName: string | null;
  createdAt: Date;
};

export type InitResult =
  | {
      index: number;
      status: 'upload';
      uploadId: string;
      strategy: DatabankUploadStrategy;
      /** Byte length of every part except the last (SINGLE: the whole file). */
      partSize: number;
      /** SINGLE uploads are presented as one part. */
      partCount: number;
      /** Parts R2 already holds at the right size (resume) — don't re-send. */
      doneParts: number[];
      /** Presigned URLs for (up to 64 of) the parts still to send. */
      urls: PartUrl[];
      resumed: boolean;
      expiresAt: Date;
    }
  | { index: number; status: 'already-uploaded' | 'duplicate' | 'possible-duplicate'; existing: ExistingFile }
  | { index: number; status: 'rejected'; reason: string };

export type CompleteResult =
  | { id: string; status: 'completed'; file: unknown; relocated?: boolean }
  | { id: string; status: 'in-progress' }
  | { id: string; status: 'missing-parts'; missingParts: number[] }
  | { id: string; status: 'failed'; reason: string }
  | { id: string; status: 'expired' }
  | { id: string; status: 'retry'; reason: string }
  | { id: string; status: 'not-found' };

/** Run `fn` over `items` with at most `limit` in flight; results keep order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A clean, short extension for the object key (never the user's raw name). */
function keyExtension(fileName: string): string {
  if (!fileName.includes('.')) return 'bin';
  const ext = (fileName.split('.').pop() ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16).toLowerCase();
  return ext || 'bin';
}

const isThrottled = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  const code = err?.$metadata?.httpStatusCode;
  return code === 429 || code === 503 || err?.name === 'SlowDown' || err?.name === 'TooManyRequests';
};

/**
 * Resumable browser→R2 databank uploads (Databank Phase 1 —
 * docs/databank-phase1-resumable-uploads.md).
 *
 * The browser hashes each file, INITs a session per file, PUTs the bytes STRAIGHT
 * to R2 with presigned URLs (no bytes touch the backend), and COMPLETEs. This
 * service only plans, signs, verifies and records. A DatabankFile row exists only
 * after the server has verified the whole object — existing reads (tree, copy,
 * download) never see a partial upload.
 *
 * Access is the SAME as every other databank write: DatabankService.
 * resolveWriteScope (client → manager / assigned officer / JR; personal →
 * owner / manager), re-checked at complete. Sessions are private to their creator.
 */
@Injectable()
export class DatabankUploadService {
  private readonly logger = new Logger(DatabankUploadService.name);
  private readonly maxBytes = resolveMaxUploadBytes(process.env.DATABANK_MAX_FILE_BYTES);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly databank: DatabankService,
  ) {}

  // ---------------------------------------------------------------------------
  // init — plan / resume / de-duplicate a batch of files
  // ---------------------------------------------------------------------------

  async init(
    dto: InitUploadsDto,
    user: RequestUser,
    targetUserId?: string,
  ): Promise<{ mode: 'proxy' } | { mode: 'direct'; maxBytes: number; results: InitResult[] }> {
    const scope: Scope = await this.databank.resolveWriteScope(dto, user, targetUserId);
    // Dev storage (local / supabase) has no direct-to-storage path — the client
    // falls back to the streaming multipart proxy upload.
    if (!this.storage.supportsDirectUpload) return { mode: 'proxy' };

    const now = new Date();
    const results = new Array<InitResult>(dto.files.length);
    const targetFolder = (f: InitUploadFileDto): string | null =>
      f.folderId !== undefined ? f.folderId : dto.folderId ?? null;

    // 1. Validate every file + its destination (ONE folder query for the batch).
    const folderIds = [...new Set(dto.files.map(targetFolder).filter((x): x is string => !!x))];
    const liveFolders = folderIds.length
      ? await this.prisma.databankFolder.findMany({
          where: { id: { in: folderIds }, deletedAt: null, clientId: scope.clientId, ownerUserId: scope.ownerUserId },
          select: { id: true },
        })
      : [];
    const liveFolderIds = new Set(liveFolders.map((f) => f.id));

    type Cand = { index: number; f: InitUploadFileDto; folderId: string | null; plan: UploadPlan };
    let pending: Cand[] = [];
    dto.files.forEach((f, index) => {
      const folderId = targetFolder(f);
      const rejected = (reason: string) => (results[index] = { index, status: 'rejected', reason });
      try {
        this.databank.assertSafeFileName(f.fileName);
      } catch (e) {
        return rejected(e instanceof Error ? e.message : 'File name not allowed.');
      }
      if (exceedsUploadCap(f.sizeBytes, this.maxBytes)) {
        return rejected(`Larger than the ${Math.round(this.maxBytes / GiB)} GB per-file upload limit.`);
      }
      if (folderId && !liveFolderIds.has(folderId)) return rejected('The destination folder no longer exists.');
      let plan: UploadPlan;
      try {
        plan = planParts(f.sizeBytes);
      } catch {
        return rejected('Invalid file size.');
      }
      pending.push({ index, f, folderId, plan });
    });

    // 2. RESUME: the caller's live session for the same file (scope + folder +
    //    name + size + hash). R2 ListParts says which parts already arrived.
    const hashes = [...new Set(pending.map((c) => c.f.sha256))];
    const open = hashes.length
      ? await this.prisma.databankUpload.findMany({
          where: {
            createdByUserId: user.id,
            status: DatabankUploadStatus.UPLOADING,
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
            sha256: { in: hashes },
            expiresAt: { gt: now },
          },
        })
      : [];
    const claimed = new Set<string>();
    const resumes: { c: Cand; s: DatabankUpload }[] = [];
    pending = pending.filter((c) => {
      const s = open.find(
        (o) =>
          !claimed.has(o.id) &&
          o.sha256 === c.f.sha256 &&
          o.fileName === c.f.fileName &&
          o.folderId === c.folderId &&
          Number(o.sizeBytes) === c.f.sizeBytes,
      );
      if (!s) return true;
      claimed.add(s.id);
      resumes.push({ c, s });
      return false;
    });
    const lostSessions: Cand[] = [];
    await mapLimit(resumes, R2_CONCURRENCY, async ({ c, s }) => {
      try {
        results[c.index] = await this.resumeResult(c.index, s);
      } catch (e) {
        if (!isNoSuchUploadError(e)) throw e;
        // R2 no longer has it (aborted / expired) — retire the session, start fresh.
        await this.retire(s.id, DatabankUploadStatus.ABORTED, 'upload no longer exists in storage', true);
        lostSessions.push(c);
      }
    });
    pending.push(...lostSessions);

    // 3. DUPLICATES by content hash within the same scope (never across scopes,
    //    so a private file can't leak): same folder + name → already uploaded
    //    (skip silently); anywhere else → ask, unless allowDuplicate.
    const byHash = pending.length
      ? await this.prisma.databankFile.findMany({
          where: {
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
            deletedAt: null,
            sha256: { in: [...new Set(pending.map((c) => c.f.sha256))] },
          },
          select: { id: true, fileName: true, folderId: true, createdAt: true, sha256: true, folder: { select: { name: true } } },
        })
      : [];
    const ref = (r: (typeof byHash)[number]): ExistingFile => ({
      id: r.id,
      fileName: r.fileName,
      folderId: r.folderId,
      folderName: r.folder?.name ?? null,
      createdAt: r.createdAt,
    });
    pending = pending.filter((c) => {
      const same = byHash.find((r) => r.sha256 === c.f.sha256 && r.folderId === c.folderId && r.fileName === c.f.fileName);
      if (same) {
        results[c.index] = { index: c.index, status: 'already-uploaded', existing: ref(same) };
        return false;
      }
      const elsewhere = byHash.find((r) => r.sha256 === c.f.sha256);
      if (elsewhere && !c.f.allowDuplicate) {
        results[c.index] = { index: c.index, status: 'duplicate', existing: ref(elsewhere) };
        return false;
      }
      return true;
    });

    // 4. POSSIBLE duplicates among files stored before hashing existed:
    //    same folder + name + size, no hash on record.
    const names = [...new Set(pending.filter((c) => !c.f.allowDuplicate).map((c) => c.f.fileName))];
    const legacy = names.length
      ? await this.prisma.databankFile.findMany({
          where: {
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
            deletedAt: null,
            sha256: null,
            fileName: { in: names },
          },
          select: { id: true, fileName: true, folderId: true, createdAt: true, fileSizeBytes: true, folder: { select: { name: true } } },
        })
      : [];
    pending = pending.filter((c) => {
      if (c.f.allowDuplicate) return true;
      const hit = legacy.find(
        (r) => r.folderId === c.folderId && r.fileName === c.f.fileName && Number(r.fileSizeBytes ?? -1) === c.f.sizeBytes,
      );
      if (!hit) return true;
      results[c.index] = {
        index: c.index,
        status: 'possible-duplicate',
        existing: { id: hit.id, fileName: hit.fileName, folderId: hit.folderId, folderName: hit.folder?.name ?? null, createdAt: hit.createdAt },
      };
      return false;
    });

    // 5. NEW sessions: start R2 multipart uploads (outside any transaction), then
    //    insert every session in ONE query. Ids are pre-generated so rows map back
    //    to their files regardless of RETURNING order.
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const fresh = await mapLimit(pending, R2_CONCURRENCY, async (c) => {
      const storageKey = `${scope.storageFolder}/${randomUUID()}.${keyExtension(c.f.fileName)}`;
      const mimeType = c.f.mimeType?.trim() || 'application/octet-stream';
      const r2UploadId =
        c.plan.strategy === 'MULTIPART' ? await this.storage.createMultipartUpload(storageKey, mimeType) : null;
      return { c, id: randomUUID(), storageKey, mimeType, r2UploadId };
    });
    if (fresh.length) {
      try {
        await this.prisma.databankUpload.createMany({
          data: fresh.map((x) => ({
            id: x.id,
            createdByUserId: user.id,
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
            folderId: x.c.folderId,
            relativePath: x.c.f.relativePath ?? null,
            fileName: x.c.f.fileName,
            mimeType: x.mimeType,
            sizeBytes: BigInt(x.c.f.sizeBytes),
            fileLastModified: x.c.f.lastModified ? new Date(x.c.f.lastModified) : null,
            sha256: x.c.f.sha256,
            strategy: x.c.plan.strategy,
            storageKey: x.storageKey,
            r2UploadId: x.r2UploadId,
            partSize: x.c.plan.strategy === 'MULTIPART' ? x.c.plan.partSize : null,
            partCount: x.c.plan.strategy === 'MULTIPART' ? x.c.plan.partCount : null,
            expiresAt,
          })),
        });
      } catch (e) {
        // Don't leave R2 multipart uploads nobody knows about.
        await Promise.all(
          fresh
            .filter((x) => x.r2UploadId)
            .map((x) => this.storage.abortMultipartUpload(x.storageKey, x.r2UploadId!).catch(() => undefined)),
        );
        throw e;
      }
    }
    await mapLimit(fresh, R2_CONCURRENCY, async (x) => {
      const plan = x.c.plan;
      const partCount = plan.strategy === 'MULTIPART' ? plan.partCount : 1;
      const urls =
        plan.strategy === 'MULTIPART'
          ? await this.signMultipart(x.storageKey, x.r2UploadId!, Array.from({ length: Math.min(partCount, INIT_URL_BATCH) }, (_, i) => i + 1))
          : [await this.signSingle(x.storageKey, x.mimeType)];
      results[x.c.index] = {
        index: x.c.index,
        status: 'upload',
        uploadId: x.id,
        strategy: plan.strategy,
        partSize: plan.strategy === 'MULTIPART' ? plan.partSize : plan.sizeBytes,
        partCount,
        doneParts: [],
        urls,
        resumed: false,
        expiresAt,
      };
    });

    return { mode: 'direct', maxBytes: this.maxBytes, results };
  }

  /** Resume an existing UPLOADING session: what's done, and URLs for the rest. */
  private async resumeResult(index: number, s: DatabankUpload): Promise<InitResult> {
    const sizeBytes = Number(s.sizeBytes);
    if (s.strategy === DatabankUploadStrategy.SINGLE) {
      const head = await this.storage.headObjectMeta(s.storageKey);
      const done = head.exists && head.sizeBytes === sizeBytes;
      return {
        index,
        status: 'upload',
        uploadId: s.id,
        strategy: s.strategy,
        partSize: sizeBytes,
        partCount: 1,
        doneParts: done ? [1] : [],
        urls: done ? [] : [await this.signSingle(s.storageKey, s.mimeType)],
        resumed: true,
        expiresAt: s.expiresAt,
      };
    }
    const plan = { sizeBytes, partSize: s.partSize!, partCount: s.partCount! };
    const listed = await this.storage.listAllParts(s.storageKey, s.r2UploadId!);
    const done = new Set(
      listed.filter((p) => p.etag && p.sizeBytes === expectedPartBytes(plan, p.partNumber)).map((p) => p.partNumber),
    );
    const doneParts = [...done].sort((a, b) => a - b);
    const todo: number[] = [];
    for (let n = 1; n <= plan.partCount && todo.length < INIT_URL_BATCH; n++) if (!done.has(n)) todo.push(n);
    return {
      index,
      status: 'upload',
      uploadId: s.id,
      strategy: s.strategy,
      partSize: plan.partSize,
      partCount: plan.partCount,
      doneParts,
      urls: await this.signMultipart(s.storageKey, s.r2UploadId!, todo),
      resumed: true,
      expiresAt: s.expiresAt,
    };
  }

  private signMultipart(key: string, uploadId: string, partNumbers: number[]): Promise<PartUrl[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.presignUploadPart(key, uploadId, partNumber),
      })),
    );
  }

  private async signSingle(key: string, mimeType: string): Promise<PartUrl> {
    const { url, headers } = await this.storage.presignPutForKey(key, mimeType);
    return { partNumber: 1, url, headers };
  }

  // ---------------------------------------------------------------------------
  // parts — top up presigned URLs for an in-progress session
  // ---------------------------------------------------------------------------

  async signParts(id: string, dto: SignPartsDto, user: RequestUser): Promise<{ parts: PartUrl[]; expiresAt: Date }> {
    const s = await this.prisma.databankUpload.findFirst({ where: { id, createdByUserId: user.id } });
    if (!s) throw new NotFoundException('Upload not found.');
    if (s.status !== DatabankUploadStatus.UPLOADING) {
      throw new ConflictException(`This upload is ${s.status.toLowerCase()}.`);
    }
    if (s.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('This upload has expired — please start it again.');
    }
    const numbers = [...new Set(dto.partNumbers)].sort((a, b) => a - b);
    const expiresAt = new Date(Date.now() + this.storage.uploadUrlTtlSeconds * 1000);
    if (s.strategy === DatabankUploadStrategy.SINGLE) {
      if (numbers.some((n) => n !== 1)) throw new BadRequestException('A single-part upload only has part 1.');
      return { parts: [await this.signSingle(s.storageKey, s.mimeType)], expiresAt };
    }
    if (numbers.some((n) => n > s.partCount!)) throw new BadRequestException('Part number out of range.');
    return { parts: await this.signMultipart(s.storageKey, s.r2UploadId!, numbers), expiresAt };
  }

  // ---------------------------------------------------------------------------
  // open — the caller's unfinished uploads (drives the resume banner)
  // ---------------------------------------------------------------------------

  async listOpen(user: RequestUser) {
    const now = new Date();
    const rows = await this.prisma.databankUpload.findMany({
      where: {
        createdByUserId: user.id,
        OR: [
          { status: DatabankUploadStatus.UPLOADING, expiresAt: { gt: now } },
          { status: DatabankUploadStatus.COMPLETING },
          { status: DatabankUploadStatus.FAILED, updatedAt: { gt: new Date(now.getTime() - SESSION_TTL_MS) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        clientId: true,
        ownerUserId: true,
        folderId: true,
        relativePath: true,
        fileName: true,
        sizeBytes: true,
        fileLastModified: true,
        sha256: true,
        status: true,
        failureReason: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    return { uploads: rows };
  }

  // ---------------------------------------------------------------------------
  // complete — verify + record (the only way a DatabankFile row is created)
  // ---------------------------------------------------------------------------

  async complete(dto: CompleteUploadsDto, user: RequestUser): Promise<{ results: CompleteResult[] }> {
    const ids = [...new Set(dto.ids)];
    const sessions = await this.prisma.databankUpload.findMany({ where: { id: { in: ids }, createdByUserId: user.id } });
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const results = await mapLimit(ids, FINALIZE_CONCURRENCY, async (id) => {
      const s = byId.get(id);
      return s ? this.finalize(s, { user }) : ({ id, status: 'not-found' } as const);
    });
    return { results };
  }

  /**
   * Finish one session: claim → (re)check access + folder → verify the object in
   * R2 → record the DatabankFile. Shared by the complete route and the sweeper.
   * Idempotent: a second call returns the same file. All R2 calls happen OUTSIDE
   * database transactions (the pool-starvation lesson).
   */
  async finalize(s: DatabankUpload, ctx: { user?: RequestUser; sweeper?: boolean }): Promise<CompleteResult> {
    const claimedAt = new Date();
    const staleBefore = new Date(claimedAt.getTime() - COMPLETING_STALE_MS);
    const claim = await this.prisma.databankUpload.updateMany({
      where: {
        id: s.id,
        OR: [
          { status: DatabankUploadStatus.UPLOADING },
          // A claim that died (crash / deploy) may be taken over after 15 min.
          { status: DatabankUploadStatus.COMPLETING, completingAt: { lt: staleBefore } },
        ],
      },
      data: { status: DatabankUploadStatus.COMPLETING, completingAt: claimedAt },
    });
    if (claim.count === 0) return this.settledResult(s.id);

    try {
      // Access may have been revoked since init (reassigned client, lockout).
      if (ctx.user) {
        try {
          await this.databank.resolveWriteScope(
            { clientId: s.clientId ?? undefined, personal: !!s.ownerUserId },
            ctx.user,
            s.ownerUserId && s.ownerUserId !== ctx.user.id ? s.ownerUserId : undefined,
          );
        } catch (e) {
          if (e instanceof ForbiddenException || e instanceof NotFoundException) {
            await this.retire(s.id, DatabankUploadStatus.ABORTED, 'access revoked');
            await this.cleanupStorage({ ...s, status: DatabankUploadStatus.ABORTED });
            return { id: s.id, status: 'failed', reason: 'You no longer have access to this databank.' };
          }
          throw e;
        }
      }

      // Never throw away a 10 GB upload over a folder deleted mid-upload —
      // file it at the scope root instead.
      let folderId = s.folderId;
      let relocated = false;
      if (folderId) {
        const live = await this.prisma.databankFolder.findFirst({
          where: { id: folderId, deletedAt: null, clientId: s.clientId, ownerUserId: s.ownerUserId },
          select: { id: true },
        });
        if (!live) {
          folderId = null;
          relocated = true;
        }
      }

      const sizeBytes = Number(s.sizeBytes);
      let head = await this.storage.headObjectMeta(s.storageKey);

      if (s.strategy === DatabankUploadStrategy.MULTIPART && !head.exists) {
        let listed;
        try {
          listed = await this.storage.listAllParts(s.storageKey, s.r2UploadId!);
        } catch (e) {
          if (!isNoSuchUploadError(e)) throw e;
          // No object and no upload: it was aborted / auto-expired in storage.
          await this.retire(s.id, DatabankUploadStatus.ABORTED, 'upload no longer exists in storage', true);
          return { id: s.id, status: 'expired' };
        }
        const verdict = verifyParts({ sizeBytes, partSize: s.partSize!, partCount: s.partCount! }, listed);
        if (!verdict.ok) {
          await this.releaseClaim(s.id, claimedAt);
          return { id: s.id, status: 'missing-parts', missingParts: verdict.missingParts };
        }
        try {
          // ETags straight from ListParts (quoted, byte-exact) — no dependence on
          // the browser reading them through CORS.
          await this.withThrottleRetry(() =>
            this.storage.completeMultipartUpload(s.storageKey, s.r2UploadId!, verdict.completeParts),
          );
        } catch (e) {
          // A racing finalize may have completed it — the HEAD below decides.
          if (!isNoSuchUploadError(e)) throw e;
        }
        head = await this.storage.headObjectMeta(s.storageKey);
      }

      if (!head.exists) {
        if (s.strategy === DatabankUploadStrategy.SINGLE) {
          // The browser hasn't finished its PUT yet.
          await this.releaseClaim(s.id, claimedAt);
          return { id: s.id, status: 'missing-parts', missingParts: [1] };
        }
        await this.retire(s.id, DatabankUploadStatus.FAILED, 'object missing after completion');
        return { id: s.id, status: 'failed', reason: 'The upload could not be assembled. Please upload it again.' };
      }
      if (head.sizeBytes !== sizeBytes) {
        // Never record an object that isn't exactly the file that was declared.
        await this.storage.delete(s.storageKey).catch(() => undefined);
        await this.retire(s.id, DatabankUploadStatus.FAILED, `size mismatch (${head.sizeBytes} ≠ ${sizeBytes})`, true);
        return { id: s.id, status: 'failed', reason: 'The uploaded file did not match the original. Please upload it again.' };
      }

      return await this.commit(s, folderId, relocated);
    } catch (e) {
      // Transient failure (storage / DB blip): hand the session back so the
      // client can simply retry. If we crashed instead, the claim goes stale and
      // is reclaimed after 15 minutes.
      this.logger.warn(`finalize ${s.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      await this.releaseClaim(s.id, claimedAt).catch(() => undefined);
      return { id: s.id, status: 'retry', reason: 'Storage is busy — please try again.' };
    }
  }

  /** Create the DatabankFile + mark the session COMPLETED atomically. The unique
   *  uploadSessionId means a racing finalizer can never create a second row. */
  private async commit(s: DatabankUpload, folderId: string | null, relocated: boolean): Promise<CompleteResult> {
    const fileId = randomUUID();
    try {
      const [file] = await this.prisma.$transaction([
        this.prisma.databankFile.create({
          data: {
            id: fileId,
            clientId: s.clientId,
            ownerUserId: s.ownerUserId,
            folderId,
            fileName: s.fileName,
            storageKey: s.storageKey,
            mimeType: s.mimeType,
            fileSizeBytes: s.sizeBytes,
            sha256: s.sha256,
            uploadSessionId: s.id,
            source: DatabankFileSource.UPLOAD,
            uploadedByUserId: s.createdByUserId,
          },
          select: this.databank.fileSelect,
        }),
        this.prisma.databankUpload.update({
          where: { id: s.id },
          data: { status: DatabankUploadStatus.COMPLETED, fileId, completingAt: null },
        }),
      ]);
      return { id: s.id, status: 'completed', file, ...(relocated ? { relocated: true } : {}) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.databankFile.findUnique({
          where: { uploadSessionId: s.id },
          select: this.databank.fileSelect,
        });
        if (existing) {
          await this.prisma.databankUpload.updateMany({
            where: { id: s.id, status: DatabankUploadStatus.COMPLETING },
            data: { status: DatabankUploadStatus.COMPLETED, fileId: existing.id, completingAt: null },
          });
          return { id: s.id, status: 'completed', file: existing };
        }
      }
      throw e;
    }
  }

  /** Result for a session someone else holds / already settled. */
  private async settledResult(id: string): Promise<CompleteResult> {
    const s = await this.prisma.databankUpload.findUnique({ where: { id } });
    if (!s) return { id, status: 'not-found' };
    switch (s.status) {
      case DatabankUploadStatus.COMPLETED: {
        const file = s.fileId
          ? await this.prisma.databankFile.findUnique({ where: { id: s.fileId }, select: this.databank.fileSelect })
          : null;
        return file ? { id, status: 'completed', file } : { id, status: 'failed', reason: 'The file was removed.' };
      }
      case DatabankUploadStatus.COMPLETING:
        return { id, status: 'in-progress' };
      case DatabankUploadStatus.ABORTED:
        return { id, status: 'expired' };
      case DatabankUploadStatus.FAILED:
        return { id, status: 'failed', reason: s.failureReason ?? 'Upload failed.' };
      default:
        return { id, status: 'retry', reason: 'Please try again.' };
    }
  }

  /** Hand a claim back (COMPLETING → UPLOADING) — only if it's still OURS. */
  private releaseClaim(id: string, claimedAt: Date) {
    return this.prisma.databankUpload.updateMany({
      where: { id, status: DatabankUploadStatus.COMPLETING, completingAt: claimedAt },
      data: { status: DatabankUploadStatus.UPLOADING, completingAt: null },
    });
  }

  /** Move a session to a terminal state. `storageGone` = nothing left in R2. */
  private retire(id: string, status: DatabankUploadStatus, reason: string, storageGone = false) {
    return this.prisma.databankUpload.updateMany({
      where: { id },
      data: { status, failureReason: reason, completingAt: null, ...(storageGone ? { r2CleanedAt: new Date() } : {}) },
    });
  }

  /** Retry R2 throttling (429 / 503 SlowDown) a few times with backoff. */
  private async withThrottleRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await fn();
      } catch (e) {
        if (!isThrottled(e) || i >= attempts - 1) throw e;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // abort — cancel an upload and free its storage
  // ---------------------------------------------------------------------------

  async abort(id: string, user: RequestUser): Promise<{ id: string; status: 'aborted' }> {
    const cas = await this.prisma.databankUpload.updateMany({
      where: {
        id,
        createdByUserId: user.id,
        status: { in: [DatabankUploadStatus.UPLOADING, DatabankUploadStatus.FAILED] },
      },
      data: { status: DatabankUploadStatus.ABORTED, failureReason: 'cancelled', completingAt: null },
    });
    const s = await this.prisma.databankUpload.findFirst({ where: { id, createdByUserId: user.id } });
    if (!s) throw new NotFoundException('Upload not found.');
    if (cas.count === 0) {
      if (s.status === DatabankUploadStatus.ABORTED) return { id, status: 'aborted' }; // idempotent
      throw new ConflictException('This upload is already finishing and can no longer be cancelled.');
    }
    await this.cleanupStorage(s);
    return { id, status: 'aborted' };
  }

  /**
   * Free the R2 side of an ABORTED / FAILED session (best-effort; the sweeper
   * retries while r2CleanedAt is null). Never deletes an object that a
   * DatabankFile row references.
   */
  async cleanupStorage(s: DatabankUpload): Promise<void> {
    if (s.r2CleanedAt) return;
    try {
      if (s.strategy === DatabankUploadStrategy.MULTIPART && s.r2UploadId) {
        await this.storage.abortMultipartUpload(s.storageKey, s.r2UploadId);
      }
      const referenced = await this.prisma.databankFile.findFirst({
        where: { storageKey: s.storageKey },
        select: { id: true },
      });
      if (!referenced) {
        const head = await this.storage.headObjectMeta(s.storageKey);
        if (head.exists) await this.storage.delete(s.storageKey);
      }
      await this.prisma.databankUpload.updateMany({ where: { id: s.id }, data: { r2CleanedAt: new Date() } });
    } catch (e) {
      this.logger.warn(`cleanup ${s.id} deferred: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
