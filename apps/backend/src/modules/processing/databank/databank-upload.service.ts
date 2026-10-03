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
import { DatabankService, DatabankTargetFileGoneError } from './databank.service';
import {
  CompleteUploadsDto,
  InitUploadFileDto,
  InitUploadsDto,
  SignPartsDto,
} from './databank-upload.dto';
import { InitVersionDto } from './databank.dto';
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
/** Part URLs handed out per file with init; the client tops up with
 *  uploads/:id/parts as it goes (keeps a 50-file init response small). */
const INIT_URL_BATCH = 16;
/** Parallel R2 calls when creating / resuming sessions in one init. */
const R2_CONCURRENCY = 8;
/** init's insert transaction (lock → re-check → insert: ~5 round trips to the
 *  DB). maxWait: wait for a pool connection as long as a plain query does
 *  (pool_timeout 10 s) — Prisma's 2 s default would fail the whole batch under
 *  pool pressure, where a single insert just waits. */
const INIT_TXN = { timeout: 30_000, maxWait: 10_000 };
/** Permissions that allow writing to a databank (Processing / JR portals). */
export const DATABANK_WRITE_PERMISSIONS = ['processing.document.upload', 'jr.artifact.author'];
/** Parallel finalizes per complete request. */
const FINALIZE_CONCURRENCY = 6;

/** A file's identity for the init race lock: who, which databank, where, and
 *  exactly which bytes — the same fields the resume lookup matches on. */
function sessionIdentity(
  userId: string,
  scope: { clientId: string | null; ownerUserId: string | null },
  folderId: string | null,
  f: { fileName: string; sizeBytes: number; sha256: string },
): string {
  return ['databank-upload', userId, scope.clientId ?? '', scope.ownerUserId ?? '', folderId ?? '', f.fileName, f.sizeBytes, f.sha256].join('|');
}

/** Content types a browser would EXECUTE if served back inline — stored as
 *  application/octet-stream so an uploaded file can never run as a page. */
const ACTIVE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
]);

/** Normalise a client-declared MIME type: a single well-formed type/subtype
 *  (no parameters, no control characters), never an active type. */
export function safeMimeType(raw: string | undefined): string {
  const t = (raw ?? '').split(';')[0].trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(t)) return 'application/octet-stream';
  return ACTIVE_CONTENT_TYPES.has(t) ? 'application/octet-stream' : t;
}

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
      /** Parts R2 already holds at the right size — don't re-send. When this
       *  is EVERY part (urls empty), the file is already in storage: call complete. */
      doneParts: number[];
      /** Presigned URLs for the first parts still to send (top up via parts). */
      urls: PartUrl[];
      /** When these URLs stop working. */
      urlsExpireAt: Date;
      resumed: boolean;
      /** Resume deadline for the whole session. */
      sessionExpiresAt: Date;
    }
  | { index: number; status: 'already-uploaded' | 'duplicate' | 'possible-duplicate'; existing: ExistingFile }
  /** A completion for this file is already running — call complete to follow it. */
  | { index: number; status: 'in-progress'; uploadId: string }
  /** Storage hiccup for this file only — init it again. */
  | { index: number; status: 'retry'; reason: string }
  | { index: number; status: 'rejected'; reason: string };

export type CompleteResult =
  | { id: string; status: 'completed'; file: unknown; relocated?: boolean }
  | { id: string; status: 'in-progress' }
  | { id: string; status: 'missing-parts'; missingParts: number[] }
  | { id: string; status: 'failed'; reason: string }
  | { id: string; status: 'expired' }
  | { id: string; status: 'retry'; reason: string }
  | { id: string; status: 'not-found' };

/** Thrown inside the commit transaction when our claim was taken over. */
class LostClaimError extends Error {}

/** Run `fn` over `items` with at most `limit` in flight; results keep order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
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

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
 * Invariants (each guards against real data loss):
 *  - Every state change is a compare-and-set on the expected status (and, for a
 *    finalizer, its own claim time) — a caller that lost a race can never
 *    overwrite someone else's outcome.
 *  - Once R2 may hold the assembled object (Complete was sent, or HEAD saw it),
 *    a failure PARKS the session in COMPLETING (reclaimable at once) — it is
 *    never handed back to UPLOADING, where expiry/cleanup could delete it.
 *  - "The object is absent" is only concluded from a real 404 (strict HEAD),
 *    never from a transient storage error.
 *  - No object a DatabankFile references is ever deleted.
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

  private urlsExpireAt(): Date {
    return new Date(Date.now() + this.storage.uploadUrlTtlSeconds * 1000);
  }

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
    // Kill switch: DATABANK_RESUMABLE_UPLOADS=off (+ a backend restart) sends
    // NEW files to the standard upload (≤ 2 GB) — no new resumable session
    // starts. Sessions already open still finish, through init too (step 2
    // below): a file whose session is being recorded must never be uploaded a
    // second time the standard way (that would record it twice). The duplicate
    // checks (steps 3–4, read-only) still run first: the standard upload never
    // dedupes, so a re-dropped folder would otherwise store every saved file again.
    const killSwitch = process.env.DATABANK_RESUMABLE_UPLOADS === 'off';

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

    type Cand = { index: number; f: InitUploadFileDto; folderId: string | null; plan: UploadPlan; mimeType: string };
    let pending: Cand[] = [];
    const seen = new Set<string>();
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
      // The same file twice in one batch would otherwise become two sessions.
      const identity = `${folderId ?? ''}|${f.fileName}|${f.sha256}`;
      if (seen.has(identity)) return rejected('This file appears twice in this upload.');
      seen.add(identity);
      let plan: UploadPlan;
      try {
        plan = planParts(f.sizeBytes);
      } catch {
        return rejected('Invalid file size.');
      }
      pending.push({ index, f, folderId, plan, mimeType: safeMimeType(f.mimeType) });
    });

    // 2. An existing live session for the same file (scope + folder + name +
    //    size + hash): UPLOADING → resume it; COMPLETING → already finishing.
    const hashes = [...new Set(pending.map((c) => c.f.sha256))];
    const open = hashes.length
      ? await this.prisma.databankUpload.findMany({
          where: {
            createdByUserId: user.id,
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
            sha256: { in: hashes },
            // NEW-FILE sessions only — never adopt a resumable VERSION session
            // (targetFileId set, P3 PR-2). Without this, a new-file upload whose
            // content+name+folder+size happen to match an in-flight version upload
            // (same user/scope) would resume it and, at commit, attach as a version
            // of that file instead of creating the new file.
            targetFileId: null,
            // A COMPLETING session is matched even past its resume deadline — it
            // may be parked holding an assembled object; a second upload of the
            // same file would become a duplicate row.
            OR: [
              { status: DatabankUploadStatus.UPLOADING, expiresAt: { gt: now } },
              { status: DatabankUploadStatus.COMPLETING },
            ],
          },
        })
      : [];
    const taken = new Set<string>();
    const resumes: { c: Cand; s: DatabankUpload }[] = [];
    pending = pending.filter((c) => {
      const s = open.find(
        (o) =>
          !taken.has(o.id) &&
          o.sha256 === c.f.sha256 &&
          o.fileName === c.f.fileName &&
          o.folderId === c.folderId &&
          Number(o.sizeBytes) === c.f.sizeBytes,
      );
      if (!s) return true;
      taken.add(s.id);
      if (s.status === DatabankUploadStatus.COMPLETING) {
        results[c.index] = { index: c.index, status: 'in-progress', uploadId: s.id };
      } else {
        resumes.push({ c, s });
      }
      return false;
    });
    const startOver: Cand[] = [];
    await mapLimit(resumes, R2_CONCURRENCY, async ({ c, s }) => {
      try {
        results[c.index] = await this.resumeResult(c.index, s);
      } catch (e) {
        if (!isNoSuchUploadError(e)) {
          this.logger.warn(`resume ${s.id} failed: ${errMsg(e)}`);
          results[c.index] = { index: c.index, status: 'retry', reason: 'Storage is busy — please try again.' };
          return;
        }
        // The multipart upload is gone. Either it was COMPLETED into the object
        // (a finalize that died before recording it) or it was aborted/expired.
        // Only a real 404 on the object means "nothing there".
        const head = await this.storage.headObjectStrict(s.storageKey).catch(() => null);
        const size = Number(s.sizeBytes);
        if (head?.exists && head.sizeBytes === size) {
          // Fully assembled in storage but never recorded. PARK it (COMPLETING,
          // reclaimable at once) so no expiry/cleanup can ever treat it as an
          // abandoned upload; the client's complete — or the sweeper — records it.
          await this.prisma.databankUpload.updateMany({
            where: { id: s.id, status: DatabankUploadStatus.UPLOADING },
            data: { status: DatabankUploadStatus.COMPLETING, completingAt: new Date(0) },
          });
          results[c.index] = { index: c.index, status: 'in-progress', uploadId: s.id };
          return;
        }
        if (!head) {
          results[c.index] = { index: c.index, status: 'retry', reason: 'Storage is busy — please try again.' };
          return;
        }
        const moved = await this.retire(
          { id: s.id, status: DatabankUploadStatus.UPLOADING },
          DatabankUploadStatus.ABORTED,
          'upload no longer exists in storage',
          !head.exists,
        );
        if (moved === 0) {
          // Someone else (a complete) moved it first — follow that instead.
          results[c.index] = { index: c.index, status: 'in-progress', uploadId: s.id };
          return;
        }
        if (head.exists) {
          await this.cleanupStorage({ ...s, status: DatabankUploadStatus.ABORTED, updatedAt: new Date() });
        }
        startOver.push(c);
      }
    });
    pending.push(...startOver);

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

    if (killSwitch) {
      // Every file is answered (rejected / under way / already there / duplicate)
      // except the new ones → the whole batch goes the standard way.
      if (!results.some((r) => r && r.status !== 'rejected')) return { mode: 'proxy' };
      // Otherwise answer those, and send only the NEW files back: the browser
      // asks again for just them (they get 'proxy' then). Never a new session.
      for (const c of pending) {
        results[c.index] = { index: c.index, status: 'retry', reason: 'Switching to the standard upload…' };
      }
      return { mode: 'direct', maxBytes: this.maxBytes, results };
    }

    // 5. NEW sessions: start R2 multipart uploads (outside any transaction; a
    //    failure affects only that file), then insert every session in ONE
    //    query with pre-generated ids.
    const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const started = await mapLimit(pending, R2_CONCURRENCY, async (c) => {
      const storageKey = `${scope.storageFolder}/${randomUUID()}.${keyExtension(c.f.fileName)}`;
      try {
        const r2UploadId =
          c.plan.strategy === 'MULTIPART'
            ? await this.withThrottleRetry(() => this.storage.createMultipartUpload(storageKey, c.mimeType))
            : null;
        return { c, id: randomUUID(), storageKey, r2UploadId };
      } catch (e) {
        this.logger.warn(`init ${c.f.fileName}: could not start upload: ${errMsg(e)}`);
        results[c.index] = { index: c.index, status: 'retry', reason: 'Storage is busy — please try again.' };
        return null;
      }
    });
    const fresh = started.filter((x): x is NonNullable<typeof x> => !!x);
    // RACE GUARD. Two inits of the same file can overlap — typically a reply
    // lost on a flaky link, and the browser's retry arriving while the first
    // request is still here. Both passed step 2 before either inserted, so both
    // would open a session and a later resume could pick the empty one. So the
    // insert runs under a lock on each file's identity (sorted, one statement:
    // no deadlock between two batches), re-checks for a live session a racing
    // init created since step 2, and inserts only the files that lost no race.
    let won = fresh;
    let lost: Array<{ x: (typeof fresh)[number]; rival: DatabankUpload }> = [];
    if (fresh.length) {
      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          const keys = [...new Set(fresh.map((x) => sessionIdentity(user.id, scope, x.c.folderId, x.c.f)))].sort();
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(1145194035, hashtext(k)) FROM unnest(${keys}::text[]) AS t(k)`;
          const rivals = await tx.databankUpload.findMany({
            where: {
              createdByUserId: user.id,
              clientId: scope.clientId,
              ownerUserId: scope.ownerUserId,
              sha256: { in: [...new Set(fresh.map((x) => x.c.f.sha256))] },
              // NEW-FILE sessions only — a resumable VERSION session (targetFileId
              // set) is never a rival of a new-file insert (see the resume query above).
              targetFileId: null,
              OR: [
                { status: DatabankUploadStatus.UPLOADING, expiresAt: { gt: now } },
                { status: DatabankUploadStatus.COMPLETING },
              ],
            },
          });
          const winners: typeof fresh = [];
          const losers: typeof lost = [];
          for (const x of fresh) {
            const rival = rivals.find(
              (o) =>
                o.sha256 === x.c.f.sha256 &&
                o.fileName === x.c.f.fileName &&
                o.folderId === x.c.folderId &&
                Number(o.sizeBytes) === x.c.f.sizeBytes,
            );
            if (rival) losers.push({ x, rival });
            else winners.push(x);
          }
          if (winners.length) await tx.databankUpload.createMany({ data: winners.map((x) => this.sessionRow(x, user, scope, sessionExpiresAt)) });
          return { winners, losers };
        }, INIT_TXN);
        won = outcome.winners;
        lost = outcome.losers;
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
    // Lost a race: free our redundant R2 upload and follow the winner's session.
    await mapLimit(lost, R2_CONCURRENCY, async ({ x, rival }) => {
      if (x.r2UploadId) await this.storage.abortMultipartUpload(x.storageKey, x.r2UploadId).catch(() => undefined);
      if (rival.status === DatabankUploadStatus.COMPLETING) {
        results[x.c.index] = { index: x.c.index, status: 'in-progress', uploadId: rival.id };
        return;
      }
      try {
        results[x.c.index] = await this.resumeResult(x.c.index, rival);
      } catch (e) {
        // The winner's R2 state needs the full step-2 handling (lost upload,
        // assembled object…): ask the browser to init again, which does it.
        this.logger.warn(`init race resume ${rival.id} failed: ${errMsg(e)}`);
        results[x.c.index] = { index: x.c.index, status: 'retry', reason: 'Storage is busy — please try again.' };
      }
    });
    await mapLimit(won, R2_CONCURRENCY, async (x) => {
      const plan = x.c.plan;
      const multipart = plan.strategy === 'MULTIPART';
      const partCount = multipart ? plan.partCount : 1;
      const urls = multipart
        ? await this.signMultipart(x.storageKey, x.r2UploadId!, Array.from({ length: Math.min(partCount, INIT_URL_BATCH) }, (_, i) => i + 1))
        : [await this.signSingle(x.storageKey, x.c.mimeType)];
      results[x.c.index] = {
        index: x.c.index,
        status: 'upload',
        uploadId: x.id,
        strategy: plan.strategy,
        partSize: multipart ? plan.partSize : plan.sizeBytes,
        partCount,
        doneParts: [],
        urls,
        urlsExpireAt: this.urlsExpireAt(),
        resumed: false,
        sessionExpiresAt,
      };
    });

    return { mode: 'direct', maxBytes: this.maxBytes, results };
  }

  // ---------------------------------------------------------------------------
  // initVersion — a SEPARATE single-file init for a resumable NEW VERSION of an
  // existing file (P3 PR-2). The batch init() above is the hot, dedup-heavy
  // new-file path and is left UNTOUCHED. A version is always "new bytes for this
  // exact file", so there is no duplicate scanning here; the session carries
  // targetFileId so commit() attaches the finished object as a new version.
  // ---------------------------------------------------------------------------

  async initVersion(
    fileId: string,
    dto: InitVersionDto,
    user: RequestUser,
    // Kept for route symmetry with the other upload endpoints. A version's scope
    // is the TARGET FILE's own (client/owner), resolved below, so it is unused.
    _targetUserId?: string,
  ): Promise<{ mode: 'proxy' } | { mode: 'direct'; maxBytes: number; result: InitResult }> {
    const direct = (result: InitResult) => ({ mode: 'direct' as const, maxBytes: this.maxBytes, result });
    const retry = (reason: string): InitResult => ({ index: 0, status: 'retry', reason });
    const inProgress = (uploadId: string): InitResult => ({ index: 0, status: 'in-progress', uploadId });
    // Dev storage (local / supabase) has no direct-to-storage path — the client
    // falls back to the small direct version upload (commitNewVersion) or the proxy.
    if (!this.storage.supportsDirectUpload) return { mode: 'proxy' };
    // Authorise a WRITE on the file's OWN scope (404s a missing/trashed file).
    const file = await this.databank.loadFileForVersionWrite(fileId, user);
    this.databank.assertSafeFileName(dto.fileName);
    if (exceedsUploadCap(dto.sizeBytes, this.maxBytes)) {
      return direct({ index: 0, status: 'rejected', reason: `Larger than the ${Math.round(this.maxBytes / GiB)} GB per-file upload limit.` });
    }
    let plan: UploadPlan;
    try {
      plan = planParts(dto.sizeBytes);
    } catch {
      return direct({ index: 0, status: 'rejected', reason: 'Invalid file size.' });
    }
    // Kill switch: DATABANK_RESUMABLE_UPLOADS=off sends a new version down the
    // direct (≤ 2 GB) path instead — no new resumable session starts.
    if (process.env.DATABANK_RESUMABLE_UPLOADS === 'off') return { mode: 'proxy' };

    // The object lives under the file's OWN scope folder (mirrors fileScope /
    // resolveWriteScope).
    const scope: Scope = file.clientId
      ? { clientId: file.clientId, ownerUserId: null, storageFolder: `databank/clients/${file.clientId}` }
      : { clientId: null, ownerUserId: file.ownerUserId, storageFolder: `databank/users/${file.ownerUserId}` };
    const mimeType = safeMimeType(dto.mimeType);
    const now = new Date();

    // RESUME: a live session for THIS file + exact bytes (same creator).
    const open = await this.prisma.databankUpload.findFirst({
      where: {
        createdByUserId: user.id,
        targetFileId: fileId,
        sha256: dto.sha256,
        OR: [
          { status: DatabankUploadStatus.UPLOADING, expiresAt: { gt: now } },
          { status: DatabankUploadStatus.COMPLETING },
        ],
      },
    });
    if (open) {
      if (open.status === DatabankUploadStatus.COMPLETING) return direct(inProgress(open.id));
      // UPLOADING — resume it, reusing init step 2's NoSuchUpload recovery.
      try {
        return direct(await this.resumeResult(0, open));
      } catch (e) {
        if (!isNoSuchUploadError(e)) {
          this.logger.warn(`initVersion resume ${open.id} failed: ${errMsg(e)}`);
          return direct(retry('Storage is busy — please try again.'));
        }
        // The multipart upload is gone: completed into the object (never recorded)
        // or aborted/expired. Only a real 404 on the object means "nothing there".
        const head = await this.storage.headObjectStrict(open.storageKey).catch(() => null);
        const size = Number(open.sizeBytes);
        if (head?.exists && head.sizeBytes === size) {
          // Fully assembled but never recorded → PARK it (reclaimable at once).
          await this.prisma.databankUpload.updateMany({
            where: { id: open.id, status: DatabankUploadStatus.UPLOADING },
            data: { status: DatabankUploadStatus.COMPLETING, completingAt: new Date(0) },
          });
          return direct(inProgress(open.id));
        }
        if (!head) return direct(retry('Storage is busy — please try again.'));
        const moved = await this.retire(
          { id: open.id, status: DatabankUploadStatus.UPLOADING },
          DatabankUploadStatus.ABORTED,
          'upload no longer exists in storage',
          !head.exists,
        );
        if (moved === 0) return direct(inProgress(open.id)); // someone else moved it — follow that
        if (head.exists) await this.cleanupStorage({ ...open, status: DatabankUploadStatus.ABORTED, updatedAt: new Date() });
        // truly gone → fall through and create a fresh session below.
      }
    }

    // CREATE a new session. Start the R2 multipart upload (outside the txn; a
    // failure affects only this file), then insert under the version-identity
    // advisory lock (ns 1145194035 — the init-race namespace — with a key that can
    // never collide with the new-file identity sessionIdentity), re-checking for a
    // live session a racing initVersion created since the findFirst above.
    const storageKey = `${scope.storageFolder}/${randomUUID()}.${keyExtension(dto.fileName)}`;
    let r2UploadId: string | null = null;
    try {
      r2UploadId =
        plan.strategy === 'MULTIPART'
          ? await this.withThrottleRetry(() => this.storage.createMultipartUpload(storageKey, mimeType))
          : null;
    } catch (e) {
      this.logger.warn(`initVersion ${dto.fileName}: could not start upload: ${errMsg(e)}`);
      return direct(retry('Storage is busy — please try again.'));
    }
    const id = randomUUID();
    const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const identityKey = `databank-version|${fileId}|${dto.sha256}`;
    let created: { won: true } | { won: false; rival: DatabankUpload };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1145194035, hashtext(${identityKey}))`;
        const rival = await tx.databankUpload.findFirst({
          where: {
            createdByUserId: user.id,
            targetFileId: fileId,
            sha256: dto.sha256,
            OR: [
              { status: DatabankUploadStatus.UPLOADING, expiresAt: { gt: now } },
              { status: DatabankUploadStatus.COMPLETING },
            ],
          },
        });
        if (rival) return { won: false as const, rival };
        await tx.databankUpload.create({
          data: {
            id,
            createdByUserId: user.id,
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
            folderId: file.folderId,
            targetFileId: fileId,
            relativePath: null,
            fileName: dto.fileName,
            mimeType,
            sizeBytes: BigInt(dto.sizeBytes),
            fileLastModified: null,
            sha256: dto.sha256,
            strategy: plan.strategy,
            storageKey,
            r2UploadId,
            partSize: plan.strategy === 'MULTIPART' ? plan.partSize : null,
            partCount: plan.strategy === 'MULTIPART' ? plan.partCount : null,
            expiresAt: sessionExpiresAt,
          },
        });
        return { won: true as const };
      }, INIT_TXN);
    } catch (e) {
      // Don't leave an R2 multipart upload nobody knows about.
      if (r2UploadId) await this.storage.abortMultipartUpload(storageKey, r2UploadId).catch(() => undefined);
      throw e;
    }
    if (!created.won) {
      // Lost the race: free our redundant R2 upload and follow the winner.
      if (r2UploadId) await this.storage.abortMultipartUpload(storageKey, r2UploadId).catch(() => undefined);
      const rival = created.rival;
      if (rival.status === DatabankUploadStatus.COMPLETING) return direct(inProgress(rival.id));
      try {
        return direct(await this.resumeResult(0, rival));
      } catch (e) {
        this.logger.warn(`initVersion race resume ${rival.id} failed: ${errMsg(e)}`);
        return direct(retry('Storage is busy — please try again.'));
      }
    }

    if (plan.strategy === 'MULTIPART') {
      const urls = await this.signMultipart(
        storageKey,
        r2UploadId!,
        Array.from({ length: Math.min(plan.partCount, INIT_URL_BATCH) }, (_, i) => i + 1),
      );
      return direct({
        index: 0,
        status: 'upload',
        uploadId: id,
        strategy: plan.strategy,
        partSize: plan.partSize,
        partCount: plan.partCount,
        doneParts: [],
        urls,
        urlsExpireAt: this.urlsExpireAt(),
        resumed: false,
        sessionExpiresAt,
      });
    }
    return direct({
      index: 0,
      status: 'upload',
      uploadId: id,
      strategy: plan.strategy,
      partSize: plan.sizeBytes,
      partCount: 1,
      doneParts: [],
      urls: [await this.signSingle(storageKey, mimeType)],
      urlsExpireAt: this.urlsExpireAt(),
      resumed: false,
      sessionExpiresAt,
    });
  }

  /** One new session row (the insert's shape, shared by init). */
  private sessionRow(
    x: { c: { folderId: string | null; f: InitUploadFileDto; plan: UploadPlan; mimeType: string }; id: string; storageKey: string; r2UploadId: string | null },
    user: RequestUser,
    scope: Scope,
    expiresAt: Date,
  ): Prisma.DatabankUploadCreateManyInput {
    return {
      id: x.id,
      createdByUserId: user.id,
      clientId: scope.clientId,
      ownerUserId: scope.ownerUserId,
      folderId: x.c.folderId,
      relativePath: x.c.f.relativePath ?? null,
      fileName: x.c.f.fileName,
      mimeType: x.c.mimeType,
      sizeBytes: BigInt(x.c.f.sizeBytes),
      fileLastModified: x.c.f.lastModified !== undefined ? new Date(x.c.f.lastModified) : null,
      sha256: x.c.f.sha256,
      strategy: x.c.plan.strategy,
      storageKey: x.storageKey,
      r2UploadId: x.r2UploadId,
      partSize: x.c.plan.strategy === 'MULTIPART' ? x.c.plan.partSize : null,
      partCount: x.c.plan.strategy === 'MULTIPART' ? x.c.plan.partCount : null,
      expiresAt,
    };
  }

  private uploadResult(index: number, s: DatabankUpload, doneParts: number[], urls: PartUrl[], resumed: boolean): InitResult {
    const multipart = s.strategy === DatabankUploadStrategy.MULTIPART;
    return {
      index,
      status: 'upload',
      uploadId: s.id,
      strategy: s.strategy,
      partSize: multipart ? s.partSize! : Number(s.sizeBytes),
      partCount: multipart ? s.partCount! : 1,
      doneParts,
      urls,
      urlsExpireAt: this.urlsExpireAt(),
      resumed,
      sessionExpiresAt: s.expiresAt,
    };
  }

  /** Resume an existing UPLOADING session: what's done, and URLs for the rest. */
  private async resumeResult(index: number, s: DatabankUpload): Promise<InitResult> {
    const sizeBytes = Number(s.sizeBytes);
    if (s.strategy === DatabankUploadStrategy.SINGLE) {
      const head = await this.storage.headObjectStrict(s.storageKey);
      const done = head.exists && head.sizeBytes === sizeBytes;
      return this.uploadResult(index, s, done ? [1] : [], done ? [] : [await this.signSingle(s.storageKey, s.mimeType)], true);
    }
    const plan = { sizeBytes, partSize: s.partSize!, partCount: s.partCount! };
    const listed = await this.storage.listAllParts(s.storageKey, s.r2UploadId!);
    const done = new Set(
      listed.filter((p) => p.etag && p.sizeBytes === expectedPartBytes(plan, p.partNumber)).map((p) => p.partNumber),
    );
    const todo: number[] = [];
    for (let n = 1; n <= plan.partCount && todo.length < INIT_URL_BATCH; n++) if (!done.has(n)) todo.push(n);
    return this.uploadResult(
      index,
      s,
      [...done].sort((a, b) => a - b),
      await this.signMultipart(s.storageKey, s.r2UploadId!, todo),
      true,
    );
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

  async signParts(id: string, dto: SignPartsDto, user: RequestUser): Promise<{ parts: PartUrl[]; urlsExpireAt: Date }> {
    const s = await this.prisma.databankUpload.findFirst({ where: { id, createdByUserId: user.id } });
    if (!s) throw new NotFoundException('Upload not found.');
    if (s.status !== DatabankUploadStatus.UPLOADING) {
      throw new ConflictException(`This upload is ${s.status.toLowerCase()}.`);
    }
    if (s.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('This upload has expired — please start it again.');
    }
    // Access is re-checked before EVERY new write URL: once it's revoked, no
    // further bytes can be written into this databank.
    await this.databank.resolveWriteScope(
      { clientId: s.clientId ?? undefined, personal: !!s.ownerUserId },
      user,
      s.ownerUserId && s.ownerUserId !== user.id ? s.ownerUserId : undefined,
    );
    const numbers = [...new Set(dto.partNumbers)].sort((a, b) => a - b);
    const urlsExpireAt = this.urlsExpireAt();
    if (s.strategy === DatabankUploadStrategy.SINGLE) {
      if (numbers.some((n) => n !== 1)) throw new BadRequestException('A single-part upload only has part 1.');
      return { parts: [await this.signSingle(s.storageKey, s.mimeType)], urlsExpireAt };
    }
    if (numbers.some((n) => n > s.partCount!)) throw new BadRequestException('Part number out of range.');
    return { parts: await this.signMultipart(s.storageKey, s.r2UploadId!, numbers), urlsExpireAt };
  }

  // ---------------------------------------------------------------------------
  // open — the caller's unfinished uploads (drives the resume banner)
  // ---------------------------------------------------------------------------

  async listOpen(user: RequestUser) {
    const LIMIT = 200;
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIMIT + 1,
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
    return { uploads: rows.slice(0, LIMIT), hasMore: rows.length > LIMIT };
  }

  // ---------------------------------------------------------------------------
  // complete — verify + record (the only way a DatabankFile row is created)
  // ---------------------------------------------------------------------------

  async complete(dto: CompleteUploadsDto, user: RequestUser): Promise<{ results: CompleteResult[] }> {
    const ids = [...new Set(dto.ids)];
    const sessions = await this.prisma.databankUpload.findMany({ where: { id: { in: ids }, createdByUserId: user.id } });
    const byId = new Map(sessions.map((s) => [s.id, s]));
    // One access check per scope, shared by every session in the batch.
    const scopeChecks = new Map<string, Promise<unknown>>();
    const results = await mapLimit(ids, FINALIZE_CONCURRENCY, async (id) => {
      const s = byId.get(id);
      return s ? this.finalize(s, { user, scopeChecks }) : ({ id, status: 'not-found' } as const);
    });
    return { results };
  }

  /**
   * Finish one session: claim → (re)check access → verify the object in R2 →
   * record the DatabankFile. Shared by the complete route and the sweeper.
   * Idempotent: a repeat call reports the same outcome.
   *
   * SWEEPER CONTRACT (Phase 1 PR-5): access is re-checked only when `ctx.user`
   * is given. The sweeper must build the CREATOR's current RequestUser and pass
   * it, so losing access cancels the upload on every path (deterministic);
   * and it must finalize parked COMPLETING sessions before R2's 7-day
   * auto-abort of the multipart upload.
   */
  async finalize(
    s: DatabankUpload,
    ctx: { user?: RequestUser; sweeper?: boolean; scopeChecks?: Map<string, Promise<unknown>> },
  ): Promise<CompleteResult> {
    const claimedAt = new Date();
    const staleBefore = new Date(claimedAt.getTime() - COMPLETING_STALE_MS);
    const claim = await this.prisma.databankUpload.updateMany({
      where: {
        id: s.id,
        OR: [
          { status: DatabankUploadStatus.UPLOADING },
          // A dead claim (crash / deploy / parked after an error) may be taken over.
          { status: DatabankUploadStatus.COMPLETING, completingAt: { lt: staleBefore } },
        ],
      },
      data: { status: DatabankUploadStatus.COMPLETING, completingAt: claimedAt },
    });
    if (claim.count === 0) return this.settledResult(s.id);

    const mine = { id: s.id, status: DatabankUploadStatus.COMPLETING, completingAt: claimedAt };
    // RULE: a session goes back to UPLOADING only with PROOF that no assembled
    // object can exist — ListParts succeeded (the multipart upload is still
    // open, so it was never completed) or a single-PUT object is a real 404.
    // Every other failure PARKS it in COMPLETING (reclaimable at once), because
    // this may be a takeover of a claim that already sent Complete, and an
    // UPLOADING row is exactly what expiry/cleanup would delete.
    try {
      // Access may have been revoked since init (reassigned client, lockout).
      if (ctx.user) {
        const user = ctx.user;
        const scopeKey = `${user.id}|${s.clientId ?? ''}|${s.ownerUserId ?? ''}`;
        let check = ctx.scopeChecks?.get(scopeKey);
        if (!check) {
          check = (async () => {
            // The route guard already enforced the caller's portal permission;
            // repeating it here makes the check complete for the sweeper too,
            // which passes the creator's CURRENT permissions (an assigned case
            // alone must not be enough once the write permission is gone).
            if (!user.permissions.some((p) => DATABANK_WRITE_PERMISSIONS.includes(p))) {
              throw new ForbiddenException('No databank write permission.');
            }
            await this.databank.resolveWriteScope(
              { clientId: s.clientId ?? undefined, personal: !!s.ownerUserId },
              user,
              s.ownerUserId && s.ownerUserId !== user.id ? s.ownerUserId : undefined,
            );
          })();
          ctx.scopeChecks?.set(scopeKey, check);
        }
        try {
          await check;
        } catch (e) {
          if (e instanceof ForbiddenException || e instanceof NotFoundException) {
            // Access is checked at EVERY write step (init, part signing,
            // complete). Losing it before the upload is recorded cancels it: the
            // user can't finish it, and new part URLs stopped at revocation, so
            // nothing written after it can be kept. Someone with access can
            // upload it again.
            const moved = await this.retire(mine, DatabankUploadStatus.ABORTED, 'access revoked');
            if (moved) await this.cleanupStorage({ ...s, status: DatabankUploadStatus.ABORTED, updatedAt: new Date() });
            return {
              id: s.id,
              status: 'failed',
              reason: 'You no longer have access to this databank, so this upload was cancelled.',
            };
          }
          throw e;
        }
      }

      const sizeBytes = Number(s.sizeBytes);
      // STRICT: a transient error throws (→ retry); only a 404 means "absent".
      let head = await this.storage.headObjectStrict(s.storageKey);

      if (s.strategy === DatabankUploadStrategy.MULTIPART && !head.exists) {
        let listed: Awaited<ReturnType<StorageService['listAllParts']>> | null = null;
        try {
          listed = await this.storage.listAllParts(s.storageKey, s.r2UploadId!);
        } catch (e) {
          if (!isNoSuchUploadError(e)) throw e;
          // The upload is gone: completed by someone else, or aborted/expired.
          head = await this.storage.headObjectStrict(s.storageKey);
          if (!head.exists) {
            await this.retire(mine, DatabankUploadStatus.ABORTED, 'upload no longer exists in storage', true);
            return { id: s.id, status: 'expired' };
          }
        }
        if (listed) {
          const verdict = verifyParts({ sizeBytes, partSize: s.partSize!, partCount: s.partCount! }, listed);
          if (!verdict.ok) {
            // SAFE to hand back: ListParts just succeeded, so the multipart
            // upload is still open — it was never completed into an object.
            await this.releaseClaim(s.id, claimedAt);
            return { id: s.id, status: 'missing-parts', missingParts: verdict.missingParts };
          }
          try {
            // ETags straight from ListParts (quoted, byte-exact) — no dependence
            // on the browser reading them through CORS.
            await this.withThrottleRetry(() =>
              this.storage.completeMultipartUpload(s.storageKey, s.r2UploadId!, verdict.completeParts),
            );
          } catch (e) {
            // A racing finalize may have completed it — the HEAD below decides.
            if (!isNoSuchUploadError(e)) throw e;
          }
          head = await this.storage.headObjectStrict(s.storageKey);
        }
      }

      if (!head.exists) {
        if (s.strategy === DatabankUploadStrategy.SINGLE) {
          // The browser hasn't finished its PUT yet (a real 404 — SAFE to hand back).
          await this.releaseClaim(s.id, claimedAt);
          return { id: s.id, status: 'missing-parts', missingParts: [1] };
        }
        // Complete returned but the object isn't visible yet — never fail or
        // delete on that; park it so the next complete (or the sweeper) retries.
        await this.parkClaim(s.id, claimedAt);
        return { id: s.id, status: 'retry', reason: 'Storage is still assembling the file — please try again.' };
      }
      if (head.sizeBytes !== sizeBytes) {
        // Never record an object that isn't exactly the declared file. FAIL the
        // session first (compare-and-set on OUR claim), and only then free the
        // bytes through the one guarded cleanup path — so a stalled finalizer
        // whose claim was taken over can never delete what the taker recorded.
        const moved = await this.retire(mine, DatabankUploadStatus.FAILED, `size mismatch (${head.sizeBytes} ≠ ${sizeBytes})`);
        if (moved) await this.cleanupStorage({ ...s, status: DatabankUploadStatus.FAILED, updatedAt: new Date() });
        return { id: s.id, status: 'failed', reason: 'The uploaded file did not match the original. Please upload it again.' };
      }

      return await this.commit(s, claimedAt);
    } catch (e) {
      this.logger.warn(`finalize ${s.id} failed: ${errMsg(e)}`);
      // Unknown state (storage / DB blip): PARK, never hand back — see RULE
      // above. The next complete (or the sweeper) takes over immediately and
      // re-derives the truth from storage.
      await this.parkClaim(s.id, claimedAt).catch(() => undefined);
      return { id: s.id, status: 'retry', reason: 'Storage is busy — please try again.' };
    }
  }

  /**
   * Record the file: in ONE transaction — (1) re-check the destination folder
   * (the R2 phase can take minutes; a folder deleted meanwhile → file at the
   * scope root, `relocated`), (2) serialise on this file's identity with an
   * advisory lock, (3) reuse an identical file another session already recorded
   * (same scope + folder + name + content) instead of a duplicate row, (4) flip
   * the session COMPLETED only while OUR claim still stands (a takeover makes
   * us back off), (5) create the row. DatabankFile.uploadSessionId is unique, so
   * one session can never produce two rows.
   */
  private async commit(s: DatabankUpload, claimedAt: Date): Promise<CompleteResult> {
    const fileId = randomUUID();
    const mine = { id: s.id, status: DatabankUploadStatus.COMPLETING, completingAt: claimedAt };
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        // P3 PR-2 — a resumable NEW-VERSION session (targetFileId set) attaches
        // its verified object as a new version of an EXISTING file instead of
        // creating a new file. The whole new-file path below is byte-for-byte
        // unchanged; this is a separate early return.
        if (s.targetFileId) {
          const res = await this.databank.attachUploadedVersion(tx, {
            targetFileId: s.targetFileId,
            storageKey: s.storageKey,
            mimeType: s.mimeType,
            fileSizeBytes: s.sizeBytes,
            sha256: s.sha256,
            createdByUserId: s.createdByUserId,
            uploadSessionId: s.id,
          });
          const done = await tx.databankUpload.updateMany({
            where: mine,
            // no-op → our bytes are redundant (twin-cleanup frees them); attach →
            // our bytes ARE the new current version, so keep them (r2CleanedAt now,
            // exactly like the new-file commit once its object is the file's bytes).
            data: {
              status: DatabankUploadStatus.COMPLETED,
              fileId: res.file.id,
              completingAt: null,
              r2CleanedAt: res.noop ? null : new Date(),
            },
          });
          if (done.count !== 1) throw new LostClaimError();
          return { file: res.file, twin: res.noop, relocated: false };
        }
        let folderId = s.folderId;
        let relocated = false;
        if (folderId) {
          // FOR SHARE: a concurrent deleteFolder (which trashes folder rows
          // before their files) either waits for this commit — and then trashes
          // our file with its folder — or finishes first, and we relocate.
          const live = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "processing"."databank_folders"
             WHERE "id" = ${folderId} AND "deletedAt" IS NULL
               AND "clientId" IS NOT DISTINCT FROM ${s.clientId}
               AND "ownerUserId" IS NOT DISTINCT FROM ${s.ownerUserId}
             FOR SHARE`;
          if (!live.length) {
            folderId = null;
            relocated = true;
          }
        }
        // Two sessions committing the same file at the same instant would both
        // miss each other's row under READ COMMITTED — the lock serialises them.
        const identity = `databank-file|${s.clientId ?? ''}|${s.ownerUserId ?? ''}|${folderId ?? ''}|${s.fileName}|${s.sha256}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity}))`;
        const twin = await tx.databankFile.findFirst({
          where: {
            clientId: s.clientId,
            ownerUserId: s.ownerUserId,
            folderId,
            fileName: s.fileName,
            sha256: s.sha256,
            deletedAt: null,
          },
          select: this.databank.fileSelect,
        });
        const done = await tx.databankUpload.updateMany({
          where: mine,
          // r2CleanedAt = "nothing left in R2 to free for this session": true at
          // once for a normal commit (the object IS the file); a twin's own
          // redundant bytes stay pending until cleanupStorage frees them — so
          // "COMPLETED with r2CleanedAt null" identifies exactly those twins.
          data: {
            status: DatabankUploadStatus.COMPLETED,
            fileId: twin ? twin.id : fileId,
            completingAt: null,
            r2CleanedAt: twin ? null : new Date(),
          },
        });
        if (done.count !== 1) throw new LostClaimError();
        if (twin) return { file: twin, twin: true, relocated };
        const file = await tx.databankFile.create({
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
        });
        return { file, twin: false, relocated };
      });
      if (outcome.twin) {
        // This session's copy of the bytes is redundant — free it (cleanup never
        // touches an object a file row references). Best-effort here; r2CleanedAt
        // is set only once it succeeds (and, for a single-PUT, only after its
        // URLs have expired). SWEEPER CONTRACT: retry COMPLETED sessions with
        // r2CleanedAt null whose file row (fileId) has uploadSessionId ≠ the
        // session's id — those are twins whose own bytes are still to free.
        await this.cleanupStorage({ ...s, status: DatabankUploadStatus.COMPLETED, updatedAt: new Date() });
      }
      return { id: s.id, status: 'completed', file: outcome.file, ...(outcome.relocated ? { relocated: true } : {}) };
    } catch (e) {
      if (e instanceof LostClaimError) return this.settledResult(s.id);
      if (e instanceof DatabankTargetFileGoneError) {
        // P3 PR-2 — the file this resumable version targeted was trashed/removed
        // mid-upload. Retrying can never succeed → terminal: fail it and free the
        // now-homeless bytes (the object is this session's own, referenced by nothing).
        const moved = await this.retire(mine, DatabankUploadStatus.FAILED, 'target file no longer exists');
        if (moved) await this.cleanupStorage({ ...s, status: DatabankUploadStatus.FAILED, updatedAt: new Date() });
        return { id: s.id, status: 'failed', reason: 'The file you were adding a version to was removed.' };
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        // A row this file must point at is GONE (e.g. the client was deleted —
        // its databank files cascade away). Retrying can never succeed, so this
        // is terminal: fail it and free the bytes, which now have no home.
        const moved = await this.retire(mine, DatabankUploadStatus.FAILED, 'destination no longer exists');
        if (moved) await this.cleanupStorage({ ...s, status: DatabankUploadStatus.FAILED, updatedAt: new Date() });
        return { id: s.id, status: 'failed', reason: 'The databank this upload belonged to no longer exists.' };
      }
      // Only a clash on uploadSessionId means "a racing finalizer already made
      // this session's row"; any other unique clash is a real error.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        JSON.stringify(e.meta?.target ?? '').includes('uploadSessionId')
      ) {
        if (s.targetFileId) {
          // P3 PR-2 — a VERSION session's uploadSessionId lives on
          // databankFileVersion (its fileId is the EXISTING target file), not on
          // databankFile. Recover the version a racing finalizer already made.
          const ver = await this.prisma.databankFileVersion.findUnique({
            where: { uploadSessionId: s.id },
            select: { fileId: true },
          });
          const existing = ver
            ? await this.prisma.databankFile.findUnique({ where: { id: ver.fileId }, select: this.databank.fileSelect })
            : null;
          if (existing) {
            await this.prisma.databankUpload.updateMany({
              where: mine,
              // The version row is this session's OWN — its object IS kept; nothing to free.
              data: { status: DatabankUploadStatus.COMPLETED, fileId: existing.id, completingAt: null, r2CleanedAt: new Date() },
            });
            return { id: s.id, status: 'completed', file: existing };
          }
        } else {
          const existing = await this.prisma.databankFile.findUnique({
            where: { uploadSessionId: s.id },
            select: this.databank.fileSelect,
          });
          if (existing) {
            await this.prisma.databankUpload.updateMany({
              where: mine,
              // The row is this session's OWN (uploadSessionId) — nothing to free.
              data: { status: DatabankUploadStatus.COMPLETED, fileId: existing.id, completingAt: null, r2CleanedAt: new Date() },
            });
            return { id: s.id, status: 'completed', file: existing };
          }
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
        // Report the file only while it's live — a file trashed since is gone
        // from the user's point of view.
        const file = s.fileId
          ? await this.prisma.databankFile.findFirst({
              where: { id: s.fileId, deletedAt: null },
              select: this.databank.fileSelect,
            })
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

  /** Hand a claim back (COMPLETING → UPLOADING) — only if it's still OURS, and
   *  only before R2 could have assembled the object. */
  private releaseClaim(id: string, claimedAt: Date) {
    return this.prisma.databankUpload.updateMany({
      where: { id, status: DatabankUploadStatus.COMPLETING, completingAt: claimedAt },
      data: { status: DatabankUploadStatus.UPLOADING, completingAt: null },
    });
  }

  /** Keep the session COMPLETING but make our claim immediately stale, so the
   *  user's next complete (or the sweeper) takes over at once. Used once R2 may
   *  hold the object. */
  private parkClaim(id: string, claimedAt: Date) {
    return this.prisma.databankUpload.updateMany({
      where: { id, status: DatabankUploadStatus.COMPLETING, completingAt: claimedAt },
      data: { completingAt: new Date(0) },
    });
  }

  /** Compare-and-set to a terminal state; returns how many rows moved (0 = the
   *  session was no longer in the expected state — someone else decided).
   *  `storageGone` = verified nothing is left in R2. */
  private async retire(
    where: Prisma.DatabankUploadWhereInput & { id: string },
    status: DatabankUploadStatus,
    reason: string,
    storageGone = false,
  ): Promise<number> {
    const res = await this.prisma.databankUpload.updateMany({
      where,
      data: { status, failureReason: reason, completingAt: null, ...(storageGone ? { r2CleanedAt: new Date() } : {}) },
    });
    return res.count;
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
        OR: [
          { status: { in: [DatabankUploadStatus.UPLOADING, DatabankUploadStatus.FAILED] } },
          // A PARKED / dead completion can be discarded too — otherwise a
          // session that can never finish would be stuck with no way out.
          {
            status: DatabankUploadStatus.COMPLETING,
            completingAt: { lt: new Date(Date.now() - COMPLETING_STALE_MS) },
          },
        ],
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
   * retries while r2CleanedAt is null). Never deletes an object a DatabankFile
   * references, and never concludes "nothing left" from anything but a 404.
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
        const head = await this.storage.headObjectStrict(s.storageKey);
        if (head.exists) await this.storage.delete(s.storageKey);
        if (
          s.strategy === DatabankUploadStrategy.SINGLE &&
          Date.now() < s.updatedAt.getTime() + this.storage.uploadUrlTtlSeconds * 1000
        ) {
          // A single-PUT URL may still be live: a PUT in flight could (re)create
          // the object AFTER this pass, deleted or not. Leave r2CleanedAt unset
          // so the sweeper re-checks once every URL for this session has expired.
          return;
        }
      }
      await this.prisma.databankUpload.updateMany({ where: { id: s.id }, data: { r2CleanedAt: new Date() } });
    } catch (e) {
      this.logger.warn(`cleanup ${s.id} deferred: ${errMsg(e)}`);
    }
  }
}
