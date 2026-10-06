import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { DatabankDepartment, DatabankFileSource, DatabankShareAccess, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RequestUser } from '../../../common/types/auth.types';
import {
  CommitUploadDto,
  CommitVersionDto,
  CopyFileDto,
  CopyFolderDto,
  CreateFolderDto,
  EnsureFolderPathsDto,
  PresignUploadDto,
  PresignVersionDto,
  UpdateFileDto,
} from './databank.dto';
import { FolderPathError, FolderPlan, planFolderPaths, splitFolderPath } from './folder-paths';

/** Folder-structure transactions (see lockFolderScope). Generous: a caller may
 *  queue behind a big first drop, which inserts thousands of rows ~90 ms away
 *  in the Seoul DB (Prisma's 5 s default would abort the waiter). */
const FOLDER_TXN = { timeout: 30_000 };

/** Cycle-guard wording for a folder COPY (assertNoCycle defaults to move wording). */
const COPY_CYCLE_MSG = "A folder can't be copied into itself or one of its own subfolders";


/** Split a search box value into words (max 5). EVERY word must match
 *  somewhere, so "abdul qadir" finds first name "Abdul" + last name "Qadir" —
 *  a single `contains` of the whole string matched neither field. */
function searchTerms(q?: string): string[] {
  return (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
}

/** Prisma filter: every search word matches the client's first name, last name
 *  or reference code. The per-word ORs sit inside AND:[] so they can never
 *  widen sibling conditions (cf. the rep-scope OR-spread leak, #253). */
function clientTermsWhere(q?: string): Prisma.ClientWhereInput {
  const terms = searchTerms(q);
  if (!terms.length) return {};
  return {
    AND: terms.map((t) => ({
      OR: [
        { firstName: { contains: t, mode: 'insensitive' as const } },
        { lastName: { contains: t, mode: 'insensitive' as const } },
        { referenceCode: { contains: t, mode: 'insensitive' as const } },
      ],
    })),
  };
}

/** Thrown by {@link DatabankService.attachUploadedVersion} when the file a
 *  resumable version session targets was trashed/removed during the (possibly
 *  long) upload. The upload-service commit() catches it, fails the session and
 *  frees its now-homeless bytes (P3 resumable versions). */
export class DatabankTargetFileGoneError extends Error {}

/**
 * The per-client databank — a free-form, Drive-like document repository for the
 * Processing team, living alongside the structured document checklist.
 *
 * ACCESS MODEL (the whole point of this service). It is PER-CLIENT, mirroring
 * the processing case rules exactly:
 *   - processing.case.view_all  → manager, sees every client's databank
 *   - otherwise                 → officer, sees only clients they have an
 *                                 assigned case for (any case is enough —
 *                                 the databank belongs to the client, not a
 *                                 single case)
 * Every read funnels through assertClientReadAccess() (any processing officer
 * may view/download any client) and every write through assertClientWriteAccess()
 * (manager or the assigned officer only), so the rule is enforced in one place
 * per access level. Bytes live in the S3/R2
 * bucket via StorageService; rows hold only the object key.
 */
@Injectable()
export class DatabankService {
  /** Belt-and-braces on top of the Multer size cap: refuse obviously dangerous
   *  executable/script types even inside an internal tool. */
  private static readonly BLOCKED_EXT = new Set([
    'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'sh', 'js', 'mjs', 'jar', 'vbs', 'dll', 'app',
  ]);

  /** Per-file cap for the legacy single-PUT DIRECT (browser→R2) upload. The DB
   *  column is BigInt now (no longer the ceiling), but a single PUT is NOT
   *  resumable — a dropped connection restarts the whole file — so this path
   *  stays at ~2 GB. Multi-GB files go through the resumable multipart uploader
   *  (Databank Phase 1), which lifts this. A whole client folder can be any
   *  size (files upload one at a time). */
  private static readonly DIRECT_MAX_BYTES = 2_147_483_647;

  /** A single server-side CopyObject is capped at 5 GiB on S3-compatible
   *  storage (R2 included); bigger copies need multipart UploadPartCopy. */
  private static readonly COPY_MAX_BYTES = 5 * 1024 * 1024 * 1024;

  /** A recursive folder copy runs SYNCHRONOUSLY inside one request and copies
   *  files one at a time (~200 ms each server-side), so it must finish inside
   *  Node's request timeout and the edge timeout. These ceilings keep the whole
   *  copy well under that budget; a bigger tree is refused up front with advice
   *  to copy subfolders individually (a background-job path is a future follow-up). */
  private static readonly MAX_COPY_FILES = 1000;
  private static readonly MAX_COPY_FOLDERS = 2000;
  private static readonly MAX_COPY_DEPTH = 50;

  private readonly log = new Logger(DatabankService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // Processing/JR portal separation (feature-flagged)
  // ---------------------------------------------------------------------------

  /** Master switch for the Processing/JR databank separation. OFF (the default)
   *  → every read behaves BYTE-IDENTICALLY to before separation: no department
   *  predicate, no share logic, no shared/readOnly tags. ON → the department
   *  scoping + JR share-in logic below runs. Read straight from process.env (the
   *  same way StorageService reads its config) so no ConfigService dependency is
   *  introduced. */
  private separationEnabled(): boolean {
    return process.env.DATABANK_PORTAL_SEPARATION === 'on';
  }

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  private canViewAll(user: RequestUser): boolean {
    return user.permissions.includes('processing.case.view_all');
  }

  /** 404s for a missing/soft-deleted client. */
  private async assertClientExists(clientId: string): Promise<void> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found');
  }

  /**
   * READ access. Any processing user who reached these routes has already been
   * gated by the controller to processing.case.view_assigned OR view_all, so
   * every processing officer may VIEW + DOWNLOAD any client's databank (the
   * whole team can see each other's folders read-only, per the processing
   * team's request 2026-09-11). We only confirm the client exists.
   */
  private async assertClientReadAccess(clientId: string, _user: RequestUser): Promise<void> {
    await this.assertClientExists(clientId);
  }

  /**
   * WRITE predicate. True only for the people allowed to MODIFY a client's
   * databank: a manager (processing.case.view_all), the officer with a
   * processing case assigned to them for the client, or JR (jr.matter.view_all,
   * or a JR associate holding an assigned matter for the client — the shared
   * store also backs the Federal Court challenge).
   */
  private async canWriteClient(clientId: string, user: RequestUser): Promise<boolean> {
    if (this.canViewAll(user)) return true;
    const assigned = await this.prisma.processingCase.count({
      where: { clientId, assignedOfficerId: user.id },
    });
    if (assigned > 0) return true;
    if (user.permissions.includes('jr.matter.view_all')) return true;
    const jrAssigned = await this.prisma.jrMatter.count({
      where: { clientId, assignedAssociateUserId: user.id },
    });
    return jrAssigned > 0;
  }

  /**
   * Throws unless `user` may MODIFY `clientId`'s databank (create / upload /
   * rename / move / copy-into / delete). Read is broader — see
   * assertClientReadAccess. 404s for a missing/soft-deleted client.
   */
  private async assertClientWriteAccess(clientId: string, user: RequestUser): Promise<void> {
    await this.assertClientExists(clientId);
    if (!(await this.canWriteClient(clientId, user))) {
      throw new ForbiddenException(
        'This client is assigned to another officer — you can view and download, but not modify, their databank.',
      );
    }
  }

  /**
   * PERSONAL access. An associate's personal databank (ownerUserId) is visible
   * — read AND write — ONLY to the owner themselves or a processing manager
   * (processing.case.view_all). Other associates get nothing here (deliberately
   * stricter than client folders, which the whole team may read).
   */
  private assertPersonalAccess(ownerUserId: string, user: RequestUser): void {
    if (ownerUserId === user.id || this.canViewAll(user)) return;
    throw new ForbiddenException("This is another associate's personal databank.");
  }

  /** A databank row is EITHER client-scoped (clientId) OR an associate's
   *  personal item (ownerUserId). This resolves the row's scope to the right
   *  authorization. 'read' vs 'write' only differs for CLIENT rows (client read
   *  is team-wide, client write is manager/assigned-officer); PERSONAL rows are
   *  owner-or-manager for both.
   *
   *  PER-ITEM Processing/JR separation (Step 4b), gated behind the same OFF-by-
   *  default flag. `viewerDept` is the CALLING PORTAL's constant (never the
   *  request). `kind` lets the share-coverage test pick the right id — a FILE is
   *  covered by its folderId, a FOLDER by its own id.
   *    - PERSONAL rows: department-agnostic, exactly as before.
   *    - CLIENT rows, flag OFF: byte-identical to pre-separation (department-blind).
   *    - CLIENT rows, flag ON:
   *        · same department as the viewer → today's within-department behaviour;
   *        · JR viewer, Processing row → readable/writable ONLY through an active
   *          share (see {@link jrReadableProcessingScope} / {@link jrWriteCovers}).
   *          Not shared in → NotFound (hide existence, never a 403). Shared in →
   *          read allowed; write allowed only when a covering share grants WRITE
   *          (v1 shares default READ → effectively read-only), else Forbidden;
   *        · Processing viewer, JR row → NotFound (Processing never reaches JR). */
  private async authorizeRow(
    row: {
      clientId: string | null;
      ownerUserId: string | null;
      department?: DatabankDepartment;
      folderId?: string | null;
      id?: string;
    },
    user: RequestUser,
    mode: 'read' | 'write',
    viewerDept: DatabankDepartment,
    kind: 'file' | 'folder',
  ): Promise<void> {
    if (row.clientId) {
      // Flag OFF — byte-identical to pre-separation: department-blind, no shares.
      if (!this.separationEnabled()) {
        if (mode === 'write') return this.assertClientWriteAccess(row.clientId, user);
        return this.assertClientReadAccess(row.clientId, user);
      }
      // Flag ON, within the viewer's OWN department — today's within-department rule.
      if (row.department === viewerDept) {
        if (mode === 'write') return this.assertClientWriteAccess(row.clientId, user);
        return this.assertClientReadAccess(row.clientId, user);
      }
      // Flag ON, JR reaching a PROCESSING row — allowed only through an active share.
      if (viewerDept === DatabankDepartment.JR && row.department === DatabankDepartment.PROCESSING) {
        const scope = await this.jrReadableProcessingScope(row.clientId);
        if (!this.rowCoveredByScope(scope, kind, row)) {
          // Not shared in → hide its existence; never a 403 that would confirm it.
          throw new NotFoundException(kind === 'file' ? 'File not found' : 'Folder not found');
        }
        if (mode === 'read') return; // a shared-in Processing row is readable by JR
        // WRITE only when a COVERING share grants WRITE (v1 shares default READ).
        if (!(await this.jrWriteCovers(row.clientId, kind, row))) {
          throw new ForbiddenException('This Processing document is shared to JR as read-only.');
        }
        return;
      }
      // Flag ON, PROCESSING reaching a JR row (or any other cross-department pair)
      // — never reachable; hide the row's existence.
      throw new NotFoundException(kind === 'file' ? 'File not found' : 'Folder not found');
    }
    if (row.ownerUserId) return this.assertPersonalAccess(row.ownerUserId, user);
    throw new NotFoundException('Databank item is not attached to a client or an owner.');
  }

  /** Whether a Processing row falls inside a JR READ-share scope (the output of
   *  {@link jrReadableProcessingScope}): 'ALL' always covers, 'NONE' never; a
   *  folder-id set covers a FILE by its folderId and a FOLDER by its own id. */
  private rowCoveredByScope(
    scope: 'NONE' | 'ALL' | { folderIds: string[] },
    kind: 'file' | 'folder',
    row: { id?: string; folderId?: string | null },
  ): boolean {
    if (scope === 'ALL') return true;
    if (scope === 'NONE') return false;
    const testId = kind === 'file' ? row.folderId ?? null : row.id ?? null;
    return testId !== null && scope.folderIds.includes(testId);
  }

  /** Whether an ACTIVE share to JR with accessLevel WRITE covers this Processing
   *  row — the gate for a JR WRITE on a shared-in Processing item. Mirrors
   *  {@link jrReadableProcessingScope}'s coverage but over WRITE shares only: a
   *  whole-client WRITE share covers everything; a folder WRITE share covers its
   *  subtree (folder + descendants, expanded via the shared {@link collectSubtree}).
   *  v1 shares default READ, so this is normally false and a shared-in Processing
   *  row stays read-only to JR. A FILE is tested by its folderId, a FOLDER by its
   *  own id (same rule as {@link rowCoveredByScope}). */
  private async jrWriteCovers(
    clientId: string,
    kind: 'file' | 'folder',
    row: { id?: string; folderId?: string | null },
  ): Promise<boolean> {
    const shares = await this.prisma.databankShare.findMany({
      where: {
        clientId,
        toDepartment: DatabankDepartment.JR,
        revokedAt: null,
        accessLevel: DatabankShareAccess.WRITE,
      },
    });
    if (shares.length === 0) return false;
    if (shares.some((s) => s.folderId === null)) return true; // whole-client WRITE share
    const testId = kind === 'file' ? row.folderId ?? null : row.id ?? null;
    if (testId === null) return false;
    for (const s of shares) {
      if (!s.folderId) continue;
      // eslint-disable-next-line no-await-in-loop
      const ids = await this.collectSubtree(s.folderId);
      if (ids.includes(testId)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Loaders (resolve the owning scope, then authorize)
  // ---------------------------------------------------------------------------

  /** Load a folder for a WRITE operation (rename / move / delete). */
  private async loadFolder(folderId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const folder = await this.prisma.databankFolder.findFirst({
      where: { id: folderId, deletedAt: null },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.authorizeRow(folder, user, 'write', viewerDept, 'folder');
    return folder;
  }

  /** Load a file for a WRITE operation (rename / move / delete). */
  private async loadFile(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.prisma.databankFile.findFirst({
      where: { id: fileId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    await this.authorizeRow(file, user, 'write', viewerDept, 'file');
    return file;
  }

  /** Authorise a WRITE on an EXISTING file's OWN scope for a resumable
   *  new-version upload (P3 PR-2 initVersion). Reuses {@link loadFile} (404s a
   *  missing/trashed file, then authorizeRow 'write'), returning just the
   *  identity + scope the version session needs — the scope is the file's own
   *  client/owner, so no targetUserId is involved. */
  async loadFileForVersionWrite(
    fileId: string,
    user: RequestUser,
    viewerDept: DatabankDepartment,
  ): Promise<{ id: string; clientId: string | null; ownerUserId: string | null; folderId: string | null }> {
    const file = await this.loadFile(fileId, user, viewerDept);
    return { id: file.id, clientId: file.clientId, ownerUserId: file.ownerUserId, folderId: file.folderId };
  }

  /** Load a file for a READ operation (download / copy-from). Client files are
   *  readable team-wide; personal files only by the owner or a manager. */
  private async loadFileForRead(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.prisma.databankFile.findFirst({
      where: { id: fileId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    await this.authorizeRow(file, user, 'read', viewerDept, 'file');
    return file;
  }

  /** Load a LIVE folder for a READ-gated operation (any officer may read any
   *  client, like loadFileForRead) — used by copyFolder so a folder copy is
   *  gated exactly like a file copy: READ the source, WRITE the destination.
   *  NOT loadFolder, which is WRITE-gated and would make folder-copy stricter. */
  private async loadFolderForRead(folderId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const folder = await this.prisma.databankFolder.findFirst({
      where: { id: folderId, deletedAt: null },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.authorizeRow(folder, user, 'read', viewerDept, 'folder');
    return folder;
  }

  /** A caller-supplied parent folderId must be live and in the SAME scope
   *  (same client, or same personal owner) as the item being placed. Prevents
   *  filing an item into another client's — or another associate's — folder. */
  async assertFolderInScope(
    folderId: string | null | undefined,
    scope: { clientId: string | null; ownerUserId: string | null },
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string | null> {
    if (!folderId) return null;
    const folder = await db.databankFolder.findFirst({
      where: {
        id: folderId,
        deletedAt: null,
        clientId: scope.clientId,
        ownerUserId: scope.ownerUserId,
      },
      select: { id: true },
    });
    if (!folder) throw new BadRequestException('Target folder does not exist in this databank');
    return folder.id;
  }

  // ---------------------------------------------------------------------------
  // Browse
  // ---------------------------------------------------------------------------

  /**
   * The JR-readable slice of a client's PROCESSING databank, derived ONLY from
   * active shares (toDepartment JR, not revoked). This is the SINGLE source of
   * the share logic for every JR read path:
   *   - 'NONE'        → no active share; JR sees none of Processing's rows.
   *   - 'ALL'         → a whole-client share (folderId NULL); JR sees every
   *                     Processing row for the client.
   *   - { folderIds } → a folder share per row, each expanded via the existing
   *                     collectSubtree to that folder ∪ all its descendants
   *                     (deduped union); JR sees only Processing rows in them.
   * ANY whole-client share wins over folder shares (it is strictly broader).
   */
  private async jrReadableProcessingScope(
    clientId: string,
    db = this.prisma,
  ): Promise<'NONE' | 'ALL' | { folderIds: string[] }> {
    const shares = await db.databankShare.findMany({
      where: { clientId, toDepartment: DatabankDepartment.JR, revokedAt: null },
    });
    if (shares.length === 0) return 'NONE';
    if (shares.some((s) => s.folderId === null)) return 'ALL';
    const union = new Set<string>();
    for (const s of shares) {
      if (!s.folderId) continue;
      // eslint-disable-next-line no-await-in-loop
      const ids = await this.collectSubtree(s.folderId, db);
      for (const id of ids) union.add(id);
    }
    return { folderIds: [...union] };
  }

  /** A JR client's databank file count = its OWN JR files + the Processing files
   *  shared in to JR (per {@link jrReadableProcessingScope}). The single source
   *  of the JR fileCount, shared by listClientsForJr + clientsByAssociateForJr.
   *  Separation-ON only — the OFF paths keep their original, department-agnostic
   *  groupBy count unchanged. */
  private async jrClientFileCount(clientId: string): Promise<number> {
    const jrCount = await this.prisma.databankFile.count({
      where: { clientId, department: DatabankDepartment.JR, deletedAt: null },
    });
    const scope = await this.jrReadableProcessingScope(clientId);
    let sharedCount = 0;
    if (scope === 'ALL') {
      sharedCount = await this.prisma.databankFile.count({
        where: { clientId, department: DatabankDepartment.PROCESSING, deletedAt: null },
      });
    } else if (scope !== 'NONE') {
      sharedCount = await this.prisma.databankFile.count({
        where: {
          folderId: { in: scope.folderIds },
          department: DatabankDepartment.PROCESSING,
          deletedAt: null,
        },
      });
    }
    return jrCount + sharedCount;
  }

  /** The full tree for one client: every live folder + file, flat. The client
   *  builds the hierarchy from parentFolderId / folderId — cheaper than a
   *  recursive query and trivial on the render side.
   *
   *  Separation OFF → the whole client's databank, department-blind, untagged
   *  (byte-identical to pre-separation). Separation ON → scoped to `viewerDept`
   *  (from the calling portal, never the request): PROCESSING sees only its own
   *  rows; JR sees its own JR rows PLUS any Processing rows shared in to JR, with
   *  every shared-in row tagged shared/readOnly/department so the UI renders it
   *  read-only. */
  async getTree(clientId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    await this.assertClientReadAccess(clientId, user);
    const canWrite = await this.canWriteClient(clientId, user);
    // Whether the shared UI shows the Share-to-JR control: ON only in the
    // Processing portal for a manager (the only role that may grant a share).
    // Deliberately NOT gated on separationEnabled() — a manager can pre-share the
    // clients/folders JR will need BEFORE separation is switched on, so the
    // cutover has no gap (shares sit dormant until the flag flips). Always false
    // in the JR portal and for non-managers.
    const canShareToJr = viewerDept === DatabankDepartment.PROCESSING && this.canViewAll(user);

    const folderSelect = {
      id: true, name: true, parentFolderId: true, createdAt: true, updatedAt: true,
    } as const;
    const fileSelect = {
      id: true, folderId: true, fileName: true, mimeType: true, fileSizeBytes: true,
      source: true, uploadedByUserId: true, createdAt: true, updatedAt: true,
    } as const;

    // FLAG OFF — byte-identical to pre-separation: the whole client, every
    // department, no shared/readOnly/department tags. `viewerDept` is ignored.
    if (!this.separationEnabled()) {
      const [folders, files] = await Promise.all([
        this.prisma.databankFolder.findMany({
          where: { clientId, deletedAt: null },
          orderBy: { name: 'asc' },
          select: folderSelect,
        }),
        this.prisma.databankFile.findMany({
          where: { clientId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: fileSelect,
        }),
      ]);
      // canWrite tells the UI whether to show the edit controls: false = the
      // viewer may read/download but not modify (client assigned to another officer).
      return { clientId, folders, files, canWrite, canShareToJr };
    }

    // FLAG ON, PROCESSING portal — only this department's own rows (never JR's).
    if (viewerDept === DatabankDepartment.PROCESSING) {
      const [folders, files] = await Promise.all([
        this.prisma.databankFolder.findMany({
          where: { clientId, department: DatabankDepartment.PROCESSING, deletedAt: null },
          orderBy: { name: 'asc' },
          select: folderSelect,
        }),
        this.prisma.databankFile.findMany({
          where: { clientId, department: DatabankDepartment.PROCESSING, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: fileSelect,
        }),
      ]);
      return { clientId, folders, files, canWrite, canShareToJr };
    }

    // FLAG ON, JR portal — JR's OWN rows (writable per canWrite) UNION the
    // Processing rows shared in to JR (always read-only).
    const scope = await this.jrReadableProcessingScope(clientId);
    const [ownFolders, ownFiles] = await Promise.all([
      this.prisma.databankFolder.findMany({
        where: { clientId, department: DatabankDepartment.JR, deletedAt: null },
        orderBy: { name: 'asc' },
        select: folderSelect,
      }),
      this.prisma.databankFile.findMany({
        where: { clientId, department: DatabankDepartment.JR, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: fileSelect,
      }),
    ]);

    type FolderNode = (typeof ownFolders)[number] & {
      department?: DatabankDepartment;
      shared?: boolean;
      readOnly?: boolean;
    };
    type FileNode = (typeof ownFiles)[number] & {
      department?: DatabankDepartment;
      shared?: boolean;
      readOnly?: boolean;
    };

    // JR's own rows are tagged department JR (shared/readOnly left off/false).
    const folders: FolderNode[] = ownFolders.map((f) => ({ ...f, department: DatabankDepartment.JR }));
    const files: FileNode[] = ownFiles.map((f) => ({ ...f, department: DatabankDepartment.JR }));

    if (scope !== 'NONE') {
      const sharedFolderWhere: Prisma.DatabankFolderWhereInput =
        scope === 'ALL'
          ? { clientId, department: DatabankDepartment.PROCESSING, deletedAt: null }
          : { id: { in: scope.folderIds }, department: DatabankDepartment.PROCESSING, deletedAt: null };
      const sharedFileWhere: Prisma.DatabankFileWhereInput =
        scope === 'ALL'
          ? { clientId, department: DatabankDepartment.PROCESSING, deletedAt: null }
          : { folderId: { in: scope.folderIds }, department: DatabankDepartment.PROCESSING, deletedAt: null };

      const [sharedFolders, sharedFiles] = await Promise.all([
        this.prisma.databankFolder.findMany({
          where: sharedFolderWhere,
          orderBy: { name: 'asc' },
          select: folderSelect,
        }),
        this.prisma.databankFile.findMany({
          where: sharedFileWhere,
          orderBy: { createdAt: 'desc' },
          select: fileSelect,
        }),
      ]);
      // Shared-in Processing rows: tagged shared + readOnly + department so the
      // UI renders them non-editable, additive to the existing row fields.
      for (const f of sharedFolders) {
        folders.push({ ...f, shared: true, readOnly: true, department: DatabankDepartment.PROCESSING });
      }
      for (const f of sharedFiles) {
        files.push({ ...f, shared: true, readOnly: true, department: DatabankDepartment.PROCESSING });
      }
    }

    // canWrite reflects JR's OWN scope; shared-in rows are always readOnly above.
    return { clientId, folders, files, canWrite, canShareToJr };
  }

  // ---------------------------------------------------------------------------
  // Sharing (Processing → JR) — Step 5
  // ---------------------------------------------------------------------------
  // A Processing MANAGER (processing.case.view_all) grants, revokes and lists
  // the shares that expose a client's Processing databank to JR. The share rows
  // are the SINGLE source the JR read paths above consult (jrReadableProcessingScope
  // / jrWriteCovers); this is only the admin surface over them.

  /**
   * Share a client's Processing databank to JR — the WHOLE client (folderId
   * omitted/null) or ONE Processing folder (its subtree, via `folderId`). MANAGER
   * only. Respects the partial-unique "one ACTIVE share per (clientId,
   * folder-target, toDepartment=JR)": an existing active share for the same target
   * is UPDATED in place (accessLevel/note), never duplicated. Returns the share row.
   */
  async shareToJr(
    clientId: string,
    dto: { folderId?: string | null; accessLevel?: DatabankShareAccess; note?: string },
    user: RequestUser,
  ) {
    if (!this.canViewAll(user)) {
      throw new ForbiddenException('Only a Processing manager can share a client to JR.');
    }
    await this.assertClientExists(clientId);

    // You can only share a PROCESSING folder of THIS client. A missing / trashed /
    // other-client / JR-department folder is a bad request (never a silent no-op).
    const folderId = dto.folderId ?? null;
    if (folderId) {
      const folder = await this.prisma.databankFolder.findFirst({
        where: { id: folderId, deletedAt: null },
        select: { id: true, clientId: true, department: true },
      });
      if (
        !folder ||
        folder.clientId !== clientId ||
        folder.department !== DatabankDepartment.PROCESSING
      ) {
        throw new BadRequestException('You can only share a Processing folder of this client.');
      }
    }

    const accessLevel = dto.accessLevel ?? DatabankShareAccess.READ;
    const note = dto.note ?? null;

    // Upsert against the partial-unique: reuse the active share for this exact
    // target (clientId + folderId ∪ null + toDepartment JR) if one exists.
    const existing = await this.prisma.databankShare.findFirst({
      where: { clientId, folderId, toDepartment: DatabankDepartment.JR, revokedAt: null },
    });
    if (existing) {
      return this.prisma.databankShare.update({
        where: { id: existing.id },
        data: { accessLevel, note },
      });
    }
    return this.prisma.databankShare.create({
      data: {
        clientId,
        folderId,
        fromDepartment: DatabankDepartment.PROCESSING,
        toDepartment: DatabankDepartment.JR,
        accessLevel,
        grantedByUserId: user.id,
        note,
      },
    });
  }

  /**
   * Revoke (soft) a share. MANAGER only. 404s a missing OR already-revoked share.
   * Stamps revokedAt + revokedByUserId so the JR read paths stop honouring it.
   */
  async unshareFromJr(shareId: string, user: RequestUser): Promise<{ id: string; revoked: true }> {
    if (!this.canViewAll(user)) {
      throw new ForbiddenException('Only a Processing manager can revoke a JR share.');
    }
    const share = await this.prisma.databankShare.findFirst({
      where: { id: shareId, revokedAt: null },
      select: { id: true },
    });
    if (!share) throw new NotFoundException('Share not found');
    await this.prisma.databankShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date(), revokedByUserId: user.id },
    });
    return { id: share.id, revoked: true };
  }

  /**
   * List the ACTIVE shares exposing a client's Processing databank to JR. Gated by
   * the same read-access check as the other client reads (any processing officer
   * may view). `clientShared` is true when a whole-client (folderId NULL) share is
   * active; each folder share resolves its LIVE folder name (null if the folder is
   * gone or the share is whole-client).
   */
  async listShares(
    clientId: string,
    user: RequestUser,
  ): Promise<{
    clientShared: boolean;
    shares: Array<{
      id: string;
      folderId: string | null;
      folderName: string | null;
      accessLevel: DatabankShareAccess;
      grantedByUserId: string;
      createdAt: Date;
    }>;
  }> {
    await this.assertClientReadAccess(clientId, user);
    const shares = await this.prisma.databankShare.findMany({
      where: { clientId, toDepartment: DatabankDepartment.JR, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const folderIds = [
      ...new Set(shares.map((s) => s.folderId).filter((id): id is string => id !== null)),
    ];
    const folders = folderIds.length
      ? await this.prisma.databankFolder.findMany({
          where: { id: { in: folderIds }, deletedAt: null },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(folders.map((f) => [f.id, f.name]));
    return {
      clientShared: shares.some((s) => s.folderId === null),
      shares: shares.map((s) => ({
        id: s.id,
        folderId: s.folderId,
        folderName: s.folderId ? nameById.get(s.folderId) ?? null : null,
        accessLevel: s.accessLevel,
        grantedByUserId: s.grantedByUserId,
        createdAt: s.createdAt,
      })),
    };
  }

  /** The personal "my workspace" tree for one associate — their folders + files
   *  not tied to any client. Readable only by the owner or a manager. Defaults
   *  to the caller; a manager may view another associate's via targetUserId. */
  async getPersonalTree(user: RequestUser, targetUserId?: string) {
    const ownerUserId = targetUserId ?? user.id;
    this.assertPersonalAccess(ownerUserId, user);
    const canWrite = ownerUserId === user.id || this.canViewAll(user);
    const [folders, files] = await Promise.all([
      this.prisma.databankFolder.findMany({
        where: { ownerUserId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, parentFolderId: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.databankFile.findMany({
        where: { ownerUserId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, folderId: true, fileName: true, mimeType: true, fileSizeBytes: true,
          source: true, uploadedByUserId: true, createdAt: true, updatedAt: true,
        },
      }),
    ]);
    return { ownerUserId, folders, files, canWrite };
  }

  // ---------------------------------------------------------------------------
  // Search (full-text + fuzzy, server-paginated) — Databank P2
  // ---------------------------------------------------------------------------

  /** The type-facet buckets, in display order. Each maps to a mime-prefix
   *  predicate; the buckets are mutually exclusive and 'other' is their
   *  complement, so they partition every file exactly. That lets a type-filtered
   *  `total` be summed from the selected buckets' facet counts — one facet query,
   *  no extra COUNT. */
  private static readonly TYPE_BUCKETS = ['image', 'pdf', 'video', 'audio', 'office', 'other'] as const;

  /** SQL predicate matching a file's "mimeType" to a type bucket. 'other' is the
   *  negation of every known bucket, so a NULL mimeType counts as 'other' too. */
  private static bucketSql(bucket: string): Prisma.Sql {
    switch (bucket) {
      case 'image':
        return Prisma.sql`"mimeType" ILIKE 'image/%'`;
      case 'pdf':
        return Prisma.sql`"mimeType" = 'application/pdf'`;
      case 'video':
        return Prisma.sql`"mimeType" ILIKE 'video/%'`;
      case 'audio':
        return Prisma.sql`"mimeType" ILIKE 'audio/%'`;
      case 'office':
        return Prisma.sql`("mimeType" ILIKE 'application/vnd%' OR "mimeType" = 'application/msword' OR "mimeType" ILIKE 'text/%')`;
      case 'other': {
        const known = ['image', 'pdf', 'video', 'audio', 'office'].map((b) => DatabankService.bucketSql(b));
        return Prisma.sql`NOT COALESCE((${Prisma.join(known, ' OR ')}), false)`;
      }
      default:
        // Unknown bucket → never matches (callers already filter these out).
        return Prisma.sql`false`;
    }
  }

  /**
   * Full-text + substring file search across ONE scope (a client's databank OR
   * the caller's personal area), with server-side pagination and type facets.
   *
   * Scope is resolved and AUTHORIZED exactly like the rest of the service:
   * clientId → assertClientReadAccess (team-wide read), personal →
   * assertPersonalAccess (owner or manager). Exactly one must be given.
   *
   * `q` (when non-empty) matches the generated "searchVector" via
   * websearch_to_tsquery OR a "fileName" ILIKE substring, and orders by ts_rank
   * then recency. ts_rank ONLY (no similarity()) so the hot query never depends
   * on the pg_trgm extension — substring hits come from the ILIKE. Facets are
   * computed over the same scope+q filter WITHOUT the type filter, so each bucket
   * count shows what selecting that type would yield. q is ALWAYS a bound
   * parameter (Prisma.sql tagged template) — never concatenated into SQL.
   */
  async searchDatabank(
    user: RequestUser,
    params: {
      clientId?: string;
      personal?: boolean;
      q?: string;
      folderId?: string | null;
      types?: string[];
      page?: number;
      pageSize?: number;
    },
    viewerDept: DatabankDepartment,
  ) {
    if (params.clientId && params.personal) {
      throw new BadRequestException('Provide either clientId or personal: true, not both.');
    }
    let scope: Prisma.Sql;
    if (params.clientId) {
      await this.assertClientReadAccess(params.clientId, user);
      scope = Prisma.sql`"clientId" = ${params.clientId}`;
      // Separation ON — narrow the client scope by the viewer's department.
      // PROCESSING sees only its own rows; JR sees JR rows plus the Processing
      // rows shared in to JR (whole-client → TRUE, folder share → folderId in
      // the bound id array, no share → FALSE). OFF leaves the scope untouched,
      // so the client's whole databank is searched exactly as before.
      if (this.separationEnabled()) {
        if (viewerDept === DatabankDepartment.PROCESSING) {
          scope = Prisma.sql`${scope} AND "department" = 'PROCESSING'`;
        } else {
          const shareScope = await this.jrReadableProcessingScope(params.clientId);
          const sharePredicate =
            shareScope === 'ALL'
              ? Prisma.sql`TRUE`
              : shareScope === 'NONE'
                ? Prisma.sql`FALSE`
                : Prisma.sql`"folderId" = ANY(${shareScope.folderIds}::text[])`;
          scope = Prisma.sql`${scope} AND ("department" = 'JR' OR ("department" = 'PROCESSING' AND ${sharePredicate}))`;
        }
      }
    } else if (params.personal) {
      this.assertPersonalAccess(user.id, user);
      scope = Prisma.sql`"ownerUserId" = ${user.id}`;
    } else {
      throw new BadRequestException('Provide either clientId or personal: true.');
    }

    // Scope + q filter, WITHOUT the type filter — the facets are computed over
    // this set so each bucket count reflects what picking that type would yield.
    const filters: Prisma.Sql[] = [Prisma.sql`"deletedAt" IS NULL`, scope];
    if (params.folderId !== undefined) {
      filters.push(
        params.folderId === null
          ? Prisma.sql`"folderId" IS NULL`
          : Prisma.sql`"folderId" = ${params.folderId}`,
      );
    }
    const q = (params.q ?? '').trim();
    const hasQ = q.length > 0;
    if (hasQ) {
      filters.push(
        // fileName + tags carry 'simple' (unstemmed) lexemes but the query is
        // 'english' (good for the description), so an inflected term won't match
        // them via @@ — a substring fallback on the name AND the joined tags keeps
        // exact-term name/tag hits working regardless of stemming.
        Prisma.sql`("searchVector" @@ websearch_to_tsquery('english', ${q}) OR "fileName" ILIKE ${`%${q}%`} OR array_to_string("tags", ' ') ILIKE ${`%${q}%`})`,
      );
    }
    const facetWhere = Prisma.join(filters, ' AND ');

    // Requested type buckets (unknown values ignored); the results + total add
    // this on top of the facet filter.
    const selected = [
      ...new Set(
        (params.types ?? [])
          .map((t) => t.trim().toLowerCase())
          .filter((t) => (DatabankService.TYPE_BUCKETS as readonly string[]).includes(t)),
      ),
    ];
    const resultFilters = [...filters];
    if (selected.length) {
      resultFilters.push(
        Prisma.sql`(${Prisma.join(selected.map((t) => DatabankService.bucketSql(t)), ' OR ')})`,
      );
    }
    const resultWhere = Prisma.join(resultFilters, ' AND ');

    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? 50)));
    const offset = (page - 1) * pageSize;

    // "id" is the final, unique tiebreaker so LIMIT/OFFSET paging is stable when
    // ts_rank / createdAt tie (else a page boundary could drop or repeat a row).
    const orderBy = hasQ
      ? Prisma.sql`ORDER BY ts_rank("searchVector", websearch_to_tsquery('english', ${q})) DESC, "createdAt" DESC, "id" DESC`
      : Prisma.sql`ORDER BY "createdAt" DESC, "id" DESC`;

    type FileRow = {
      id: string;
      folderId: string | null;
      fileName: string;
      mimeType: string | null;
      fileSizeBytes: bigint | null;
      description: string | null;
      tags: string[];
      source: string;
      uploadedByUserId: string | null;
      createdAt: Date;
      updatedAt: Date;
    };

    const [rows, facetRows] = await Promise.all([
      this.prisma.$queryRaw<FileRow[]>(Prisma.sql`
        SELECT "id", "folderId", "fileName", "mimeType", "fileSizeBytes",
               "description", "tags", "source"::text AS "source",
               "uploadedByUserId", "createdAt", "updatedAt"
          FROM "processing"."databank_files"
         WHERE ${resultWhere}
         ${orderBy}
         LIMIT ${pageSize} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<
        Array<{ image: number; pdf: number; video: number; audio: number; office: number; other: number; total: number }>
      >(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE ${DatabankService.bucketSql('image')})::int  AS "image",
          COUNT(*) FILTER (WHERE ${DatabankService.bucketSql('pdf')})::int    AS "pdf",
          COUNT(*) FILTER (WHERE ${DatabankService.bucketSql('video')})::int  AS "video",
          COUNT(*) FILTER (WHERE ${DatabankService.bucketSql('audio')})::int  AS "audio",
          COUNT(*) FILTER (WHERE ${DatabankService.bucketSql('office')})::int AS "office",
          COUNT(*) FILTER (WHERE ${DatabankService.bucketSql('other')})::int  AS "other",
          COUNT(*)::int AS "total"
          FROM "processing"."databank_files"
         WHERE ${facetWhere}
      `),
    ]);

    const f = facetRows[0] ?? { image: 0, pdf: 0, video: 0, audio: 0, office: 0, other: 0, total: 0 };
    const byType = {
      image: Number(f.image) || 0,
      pdf: Number(f.pdf) || 0,
      video: Number(f.video) || 0,
      audio: Number(f.audio) || 0,
      office: Number(f.office) || 0,
      other: Number(f.other) || 0,
    };
    const facetTotal = Number(f.total) || 0;
    // Buckets partition the set, so a type-filtered total is the sum of the
    // selected buckets' facet counts — no separate COUNT query needed.
    const total = selected.length
      ? selected.reduce((s, t) => s + (byType as Record<string, number>)[t], 0)
      : facetTotal;

    return {
      results: rows,
      total,
      page,
      pageSize,
      facets: { byType, total: facetTotal },
    };
  }

  /** Clients for the cross-client landing page. Every processing user sees ALL
   *  clients (read-only on the ones not assigned to them — write is gated
   *  per-action). Each row carries its databank file count. */
  async listClients(user: RequestUser, viewerDept: DatabankDepartment, q?: string) {
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...clientTermsWhere(q),
    };

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: { id: true, referenceCode: true, firstName: true, lastName: true },
    });
    if (clients.length === 0) return [];

    // Separation ON — the Processing landing counts ONLY Processing files, so JR
    // rows on a shared client don't inflate the Processing count. OFF counts
    // every department exactly as before.
    const departmentFilter = this.separationEnabled()
      ? { department: DatabankDepartment.PROCESSING }
      : {};
    const counts = await this.prisma.databankFile.groupBy({
      by: ['clientId'],
      where: { deletedAt: null, clientId: { in: clients.map((c) => c.id) }, ...departmentFilter },
      _count: { _all: true },
    });
    const countByClient = new Map(counts.map((c) => [c.clientId, c._count._all]));

    // Default browse hides clients that have no databank files — auto-created /
    // empty client records would otherwise clutter the list. A search still
    // surfaces any client (even empty) so an officer can open it and upload its
    // first file.
    const hasQuery = !!q?.trim();
    const withCounts = clients.map((c) => ({ ...c, fileCount: countByClient.get(c.id) ?? 0 }));
    return hasQuery ? withCounts : withCounts.filter((c) => c.fileCount > 0);
  }

  /**
   * The same clients as {@link listClients}, but grouped by the associate they
   * belong to — i.e. the officer their processing case is assigned to. This is
   * the associate-organised Databank the processing manager asked for:
   *   - manager (view_all) → one group per officer who has assigned clients,
   *     with the manager's own group surfaced first;
   *   - officer            → every officer's group too (read-only on the ones
   *     not their own), with their own group surfaced first.
   * A client that is handled by two officers shows under both. Clients with a
   * case but no assigned officer are omitted here (they surface once assigned);
   * the flat {@link listClients} landing still reaches every client.
   */
  async clientsByAssociate(user: RequestUser, viewerDept: DatabankDepartment, q?: string) {
    const canAll = this.canViewAll(user);

    // Every processing user sees all associates' groups (read-only on the ones
    // not their own — write is gated per-action). `isSelf` surfaces their own.
    const where: Prisma.ProcessingCaseWhereInput = {
      assignedOfficerId: { not: null },
      client: { deletedAt: null },
    };
    // Every word must match the client's name/reference OR the officer's name,
    // so "abdul qadir" (first + last) and "tayyab abdul" (officer + client) work.
    const terms = searchTerms(q);
    if (terms.length) {
      where.AND = terms.map((t) => {
        const contains = { contains: t, mode: 'insensitive' as const };
        return {
          OR: [
            { client: { firstName: contains } },
            { client: { lastName: contains } },
            { client: { referenceCode: contains } },
            { assignedOfficer: { employee: { firstName: contains } } },
            { assignedOfficer: { employee: { lastName: contains } } },
          ],
        };
      });
    }

    const cases = await this.prisma.processingCase.findMany({
      where,
      select: {
        assignedOfficerId: true,
        assignedOfficer: {
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
        client: { select: { id: true, referenceCode: true, firstName: true, lastName: true } },
      },
    });

    type ClientRow = { id: string; referenceCode: string; firstName: string; lastName: string };
    const groups = new Map<
      string,
      { officerId: string; officerName: string; clients: Map<string, ClientRow> }
    >();

    for (const c of cases) {
      const officerId = c.assignedOfficerId;
      if (!officerId) continue;
      const emp = c.assignedOfficer?.employee;
      const officerName = emp
        ? `${emp.firstName} ${emp.lastName}`.trim()
        : c.assignedOfficer?.email ?? 'Unknown officer';
      let group = groups.get(officerId);
      if (!group) {
        group = { officerId, officerName, clients: new Map() };
        groups.set(officerId, group);
      }
      group.clients.set(c.client.id, c.client);
    }

    // One groupBy for every client we're about to return.
    const clientIds = [...new Set([...groups.values()].flatMap((g) => [...g.clients.keys()]))];
    const countByClient = new Map<string, number>();
    if (clientIds.length > 0) {
      // Separation ON — Processing landing counts ONLY Processing files (JR rows
      // on a shared client excluded). OFF counts every department as before.
      const departmentFilter = this.separationEnabled()
        ? { department: DatabankDepartment.PROCESSING }
        : {};
      const counts = await this.prisma.databankFile.groupBy({
        by: ['clientId'],
        where: { deletedAt: null, clientId: { in: clientIds }, ...departmentFilter },
        _count: { _all: true },
      });
      for (const c of counts) { if (c.clientId) countByClient.set(c.clientId, c._count._all); }
    }

    const byName = (a: ClientRow, b: ClientRow) =>
      `${a.firstName} ${a.lastName}`.trim().localeCompare(`${b.firstName} ${b.lastName}`.trim());

    // Default browse hides empty (file-less) clients; a search shows all
    // matches so any client can be opened to receive its first file. Associates
    // left with no visible clients drop out of the list.
    const hasQuery = !!q?.trim();
    const associates = [...groups.values()]
      .map((g) => {
        const withCounts = [...g.clients.values()]
          .sort(byName)
          .map((c) => ({ ...c, fileCount: countByClient.get(c.id) ?? 0 }));
        const visible = hasQuery ? withCounts : withCounts.filter((c) => c.fileCount > 0);
        return {
          officerId: g.officerId,
          officerName: g.officerName,
          isSelf: g.officerId === user.id,
          clientCount: visible.length,
          clients: visible,
        };
      })
      .filter((g) => g.clients.length > 0)
      .sort((a, b) => {
        // The viewer's own databank first, then alphabetical by associate name.
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        return a.officerName.localeCompare(b.officerName);
      });

    return { canSeeAll: canAll, viewerOfficerId: user.id, associates };
  }

  // ---------------------------------------------------------------------------
  // Browse — JR views onto the SAME shared store, scoped to JR-matter clients
  // ---------------------------------------------------------------------------

  /** A JR head (jr.matter.view_all) sees every JR associate's clients; a plain
   *  associate sees only the matters assigned to them. This is the JR analogue
   *  of {@link canViewAll} (which keys off processing.case.view_all). */
  private canSeeAllJr(user: RequestUser): boolean {
    return user.permissions.includes('jr.matter.view_all');
  }

  /**
   * The clients a JR caller may browse from the databank landing — the clients
   * that have a JR matter (the escalated set). Team-wide READ: every JR user
   * sees every JR-matter client (write is gated per-action in
   * {@link canWriteClient} — a JR head or the assigned associate). This mirrors
   * the Processing databank's team-wide read and stays useful even while matters
   * carry no assigned associate yet. Keyed to JR matters, so the JR portal never
   * lists the entire firm. Each row carries its databank file count.
   */
  async listClientsForJr(_user: RequestUser, viewerDept: DatabankDepartment, q?: string) {
    const separation = this.separationEnabled();
    const matters = await this.prisma.jrMatter.findMany({
      select: { clientId: true },
    });
    // Separation ON — the browseable set is JR-matter clients UNION clients with
    // an active share to JR (a shared client with no JR matter still appears).
    // OFF — JR-matter clients only, exactly as before.
    const shareClientIds = separation
      ? (
          await this.prisma.databankShare.findMany({
            where: { toDepartment: DatabankDepartment.JR, revokedAt: null },
            select: { clientId: true },
          })
        ).map((s) => s.clientId)
      : [];
    const clientIds = [...new Set([...matters.map((m) => m.clientId), ...shareClientIds])];
    if (clientIds.length === 0) return [];

    const where: Prisma.ClientWhereInput = {
      id: { in: clientIds },
      deletedAt: null,
      ...clientTermsWhere(q),
    };
    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: { id: true, referenceCode: true, firstName: true, lastName: true },
    });
    if (clients.length === 0) return [];

    // Separation ON — fileCount = JR files + shared-in Processing files per the
    // client's share scope. OFF — one department-agnostic groupBy, as before.
    if (separation) {
      return Promise.all(
        clients.map(async (c) => ({ ...c, fileCount: await this.jrClientFileCount(c.id) })),
      );
    }
    const counts = await this.prisma.databankFile.groupBy({
      by: ['clientId'],
      where: { deletedAt: null, clientId: { in: clients.map((c) => c.id) } },
      _count: { _all: true },
    });
    const countByClient = new Map(counts.map((c) => [c.clientId, c._count._all]));
    return clients.map((c) => ({ ...c, fileCount: countByClient.get(c.id) ?? 0 }));
  }

  /**
   * The same JR-matter clients as {@link listClientsForJr}, grouped by the JR
   * ASSOCIATE the matter is assigned to (JrMatter.assignedAssociateUserId — a
   * user id, NOT a processing officer). Team-wide READ: every JR user sees every
   * group, with their own surfaced first (a head can drill into any associate);
   * matters with no associate yet fall into an "Unassigned" group so nothing is
   * hidden. `canSeeAll` reports whether the viewer is a JR head (jr.matter.view_all).
   * The JR analogue of {@link clientsByAssociate}: it joins on JR matters instead
   * of processing cases, and resolves the associate's display name off the
   * Employee relation (UserAccount has no name column), exactly like
   * JudicialReviewService.listAssociates.
   */
  async clientsByAssociateForJr(user: RequestUser, viewerDept: DatabankDepartment, q?: string) {
    const separation = this.separationEnabled();
    const canAll = this.canSeeAllJr(user);
    const matters = await this.prisma.jrMatter.findMany({
      select: { clientId: true, assignedAssociateUserId: true },
    });

    // Separation ON — a client shared in to JR with NO JR matter still appears
    // (under Unassigned). OFF — JR-matter clients only, exactly as before.
    const shareClientIds = separation
      ? [
          ...new Set(
            (
              await this.prisma.databankShare.findMany({
                where: { toDepartment: DatabankDepartment.JR, revokedAt: null },
                select: { clientId: true },
              })
            ).map((s) => s.clientId),
          ),
        ]
      : [];

    if (matters.length === 0 && shareClientIds.length === 0) {
      return { canSeeAll: canAll, viewerOfficerId: user.id, associates: [] };
    }

    const clientIds = [...new Set([...matters.map((m) => m.clientId), ...shareClientIds])];
    const associateIds = [
      ...new Set(matters.map((m) => m.assignedAssociateUserId).filter((v): v is string => !!v)),
    ];

    const [clients, users] = await Promise.all([
      this.prisma.client.findMany({
        where: { id: { in: clientIds }, deletedAt: null },
        select: { id: true, referenceCode: true, firstName: true, lastName: true },
      }),
      this.prisma.userAccount.findMany({
        where: { id: { in: associateIds } },
        select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
      }),
    ]);

    const clientById = new Map(clients.map((c) => [c.id, c]));
    const nameByUser = new Map(
      users.map((u) => {
        const emp = u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : '';
        return [u.id, emp || u.email];
      }),
    );

    // fileCount per client. Separation ON → JR files + shared-in Processing files
    // (per the client's share scope). OFF → one department-agnostic groupBy, the
    // same query as before.
    const countByClient = new Map<string, number>();
    if (separation) {
      await Promise.all(
        clients.map(async (c) => {
          countByClient.set(c.id, await this.jrClientFileCount(c.id));
        }),
      );
    } else {
      const counts = await this.prisma.databankFile.groupBy({
        by: ['clientId'],
        where: { deletedAt: null, clientId: { in: clientIds } },
        _count: { _all: true },
      });
      for (const c of counts) { if (c.clientId) countByClient.set(c.clientId, c._count._all); }
    }

    // Matters with no associate yet fall into a single "Unassigned" group so
    // the head still sees every JR client (JR currently assigns associates
    // lazily — most matters start unassigned).
    const UNASSIGNED = '__unassigned__';
    type ClientRow = { id: string; referenceCode: string; firstName: string; lastName: string };
    const groups = new Map<
      string,
      { officerId: string; officerName: string; clients: Map<string, ClientRow> }
    >();
    for (const m of matters) {
      const officerId = m.assignedAssociateUserId ?? UNASSIGNED;
      const client = clientById.get(m.clientId);
      if (!client) continue; // client soft-deleted — skip
      let group = groups.get(officerId);
      if (!group) {
        group = {
          officerId,
          officerName: officerId === UNASSIGNED ? 'Unassigned' : nameByUser.get(officerId) ?? 'Unknown associate',
          clients: new Map(),
        };
        groups.set(officerId, group);
      }
      group.clients.set(client.id, client);
    }

    // Separation ON — a client shared in to JR with no JR matter has no
    // associate, so it surfaces under Unassigned (nothing is hidden).
    if (separation) {
      const mattered = new Set(matters.map((m) => m.clientId));
      for (const cid of shareClientIds) {
        if (mattered.has(cid)) continue;
        const client = clientById.get(cid);
        if (!client) continue; // client soft-deleted — skip
        let group = groups.get(UNASSIGNED);
        if (!group) {
          group = { officerId: UNASSIGNED, officerName: 'Unassigned', clients: new Map() };
          groups.set(UNASSIGNED, group);
        }
        group.clients.set(client.id, client);
      }
    }

    // Search is applied in memory (the JR set is small): a client stays if EVERY
    // search word appears in its name, its reference or its associate's name
    // (mirrors the processing per-word match over client + officer name).
    const terms = searchTerms(q).map((t) => t.toLowerCase());
    const byName = (a: ClientRow, b: ClientRow) =>
      `${a.firstName} ${a.lastName}`.trim().localeCompare(`${b.firstName} ${b.lastName}`.trim());

    const associates = [...groups.values()]
      .map((g) => {
        const rows = [...g.clients.values()]
          .filter((c) => {
            if (!terms.length) return true;
            const hay = `${c.firstName} ${c.lastName} ${c.referenceCode} ${g.officerName}`.toLowerCase();
            return terms.every((t) => hay.includes(t));
          })
          .sort(byName)
          .map((c) => ({ ...c, fileCount: countByClient.get(c.id) ?? 0 }))
          // Default browse (no search) hides empty clients; a search shows all.
          .filter((c) => terms.length > 0 || c.fileCount > 0);
        return {
          officerId: g.officerId,
          officerName: g.officerName,
          isSelf: g.officerId === user.id,
          clientCount: rows.length,
          clients: rows,
        };
      })
      .filter((g) => g.clients.length > 0)
      .sort((a, b) => {
        // Own group first, then the Unassigned bucket last, else alphabetical.
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        const au = a.officerId === UNASSIGNED;
        const bu = b.officerId === UNASSIGNED;
        if (au !== bu) return au ? 1 : -1;
        return a.officerName.localeCompare(b.officerName);
      });

    return { canSeeAll: canAll, viewerOfficerId: user.id, associates };
  }

  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------

  // FOLDER-STRUCTURE LOCK. Every write that changes a scope's folder tree —
  // create, rename, move, delete and ensure-paths — runs in a transaction that
  // first takes ONE advisory lock per scope (a client's databank, or one
  // associate's personal area). Under it the scope's folders cannot change, so:
  // two drops of the same Drive folder can't both create "Passport"; a subtree
  // delete can't miss folders created mid-delete (they'd be live children of a
  // trashed parent — invisible); two crossing moves can't make a cycle. Auth
  // runs BEFORE the transaction (it only reads), so a lock is never held across
  // it. Costs ~3 round trips on these rare writes. Files are NOT under this
  // lock: an upload commit reads its folder FOR SHARE instead (see deleteFolder).

  private async lockFolderScope(
    tx: Prisma.TransactionClient,
    scope: { clientId: string | null; ownerUserId: string | null },
  ): Promise<void> {
    const key = scope.clientId
      ? `databank-folders|client|${scope.clientId}`
      : `databank-folders|user|${scope.ownerUserId}`;
    // TWO-key form: 1145194033 ('DBF1') is this lock's namespace. (int4, int4)
    // advisory locks live apart from the single-key hashtext() locks used
    // elsewhere (upload-commit identity, attendance, telephony), so a 32-bit
    // hash collision can never make this lock and an upload commit — which holds
    // its folder FOR SHARE while it takes its own lock — wait on each other.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1145194033, hashtext(${key}))`;
  }

  // PER-FILE VERSION LOCK (P3-2). Every version-list mutation (new version /
  // restore / delete / rename) takes this advisory lock so version numbering and
  // the currentVersionId repoint are race-free. 1145194037 ('DBF5') is a NEW
  // two-key namespace, DISTINCT from 1145194033 (folder structure), 1145194035
  // (upload init-race) and the single-key hashtext() space the resumable commit
  // uses — so a 32-bit hash collision can never make this lock wait on an
  // unrelated one. It is taken ALONGSIDE a SELECT … FOR UPDATE on the file row
  // (inside the same txn), which serialises version ops against a concurrent
  // deleteFile / purge (those take the row FOR UPDATE / delete it too).
  private async lockFileVersions(tx: Prisma.TransactionClient, fileId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1145194037, hashtext(${fileId}))`;
  }

  /**
   * Serialize a file INSERT against a concurrent subtree delete / purge of its
   * destination folder, so no LIVE file is ever stranded inside a trashed (or
   * already-removed) folder. Inside the caller's transaction, take a SHARED row
   * lock on the live destination folder BEFORE the row is created: deleteFolder
   * stamps its deletedAt (an UPDATE → FOR UPDATE) and purgeFolder / the sweeper
   * hard-delete the row (DELETE → FOR UPDATE), both of which conflict with this
   * FOR SHARE, so the two serialize on the folder row:
   *   - the delete wins   → the folder is already gone / trashed here, so the
   *     row falls back to the root (null) and lands LIVE at the top, never
   *     stranded inside a folder that is being removed.
   *   - this insert wins  → the folder is still live and held; the delete then
   *     waits and trashes this freshly-recorded file together with its folder.
   * The root (null) can never be trashed, so it needs no lock. Returns the
   * folder id to store (or null for the root). This is a shared ROW lock, NOT
   * the per-scope advisory lock, so it never blocks another upload to the same
   * folder — only a delete/purge of that exact folder.
   */
  private async lockLiveDestinationFolder(
    tx: Prisma.TransactionClient,
    folderId: string | null,
    scope: { clientId: string | null; ownerUserId: string | null },
  ): Promise<string | null> {
    if (!folderId) return null;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "processing"."databank_folders"
      WHERE "id" = ${folderId}
        AND "deletedAt" IS NULL
        AND "clientId" IS NOT DISTINCT FROM ${scope.clientId}
        AND "ownerUserId" IS NOT DISTINCT FROM ${scope.ownerUserId}
      FOR SHARE`;
    return rows.length ? folderId : null;
  }

  /** Re-read a folder once its scope is locked: loadFolder ran before the lock,
   *  so the folder may have been deleted meanwhile (its scope never changes). */
  private async reloadFolder(tx: Prisma.TransactionClient, folderId: string) {
    const folder = await tx.databankFolder.findFirst({ where: { id: folderId, deletedAt: null } });
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  async createFolder(
    clientId: string,
    dto: CreateFolderDto,
    user: RequestUser,
    department: DatabankDepartment,
  ) {
    await this.assertClientWriteAccess(clientId, user);
    return this.createFolderIn({ clientId, ownerUserId: null }, dto, user, department);
  }

  /** Create a folder in an associate's PERSONAL databank (ownerUserId). Defaults
   *  to the caller's own; a manager may target another associate via targetUserId. */
  async createPersonalFolder(
    user: RequestUser,
    dto: CreateFolderDto,
    department: DatabankDepartment,
    targetUserId?: string,
  ) {
    const ownerUserId = targetUserId ?? user.id;
    this.assertPersonalAccess(ownerUserId, user);
    return this.createFolderIn({ clientId: null, ownerUserId }, dto, user, department);
  }

  /** Create one folder in an already-AUTHORIZED scope ("Passport (2)" on a name
   *  clash — a hand-made folder is always new; ensure-paths is what merges). The
   *  `department` is the CALLING PORTAL's constant (never from the request). */
  private createFolderIn(
    scope: { clientId: string | null; ownerUserId: string | null },
    dto: CreateFolderDto,
    user: RequestUser,
    department: DatabankDepartment,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      const parentFolderId = await this.assertFolderInScope(dto.parentFolderId, scope, tx);
      const name = await this.uniqueFolderName(scope, parentFolderId, dto.name.trim(), undefined, tx);
      return tx.databankFolder.create({
        data: { ...scope, parentFolderId, name, department, createdByUserId: user.id },
        select: { id: true, name: true, parentFolderId: true, createdAt: true, updatedAt: true },
      });
    }, FOLDER_TXN);
  }

  async renameFolder(folderId: string, name: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const authorized = await this.loadFolder(folderId, user, viewerDept);
    const scope = { clientId: authorized.clientId, ownerUserId: authorized.ownerUserId };
    return this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      const folder = await this.reloadFolder(tx, folderId);
      const unique = await this.uniqueFolderName(scope, folder.parentFolderId, name.trim(), folder.id, tx);
      return tx.databankFolder.update({
        where: { id: folder.id },
        data: { name: unique },
        select: { id: true, name: true, parentFolderId: true, updatedAt: true },
      });
    }, FOLDER_TXN);
  }

  async moveFolder(
    folderId: string,
    parentFolderId: string | null | undefined,
    user: RequestUser,
    viewerDept: DatabankDepartment,
  ) {
    const authorized = await this.loadFolder(folderId, user, viewerDept);
    const scope = { clientId: authorized.clientId, ownerUserId: authorized.ownerUserId };
    return this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      const folder = await this.reloadFolder(tx, folderId);
      const targetParent = await this.assertFolderInScope(parentFolderId, scope, tx);
      await this.assertNoCycle(folder.id, targetParent, tx);
      // A move can collide with an existing name in the destination — suffix it.
      const name = await this.uniqueFolderName(scope, targetParent, folder.name, folder.id, tx);
      return tx.databankFolder.update({
        where: { id: folder.id },
        data: { parentFolderId: targetParent, name },
        select: { id: true, name: true, parentFolderId: true, updatedAt: true },
      });
    }, FOLDER_TXN);
  }

  /** Soft-delete a folder and its ENTIRE subtree (descendant folders + all
   *  their files). Recoverable — nothing is removed from storage. */
  async deleteFolder(folderId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const authorized = await this.loadFolder(folderId, user, viewerDept);
    const scope = { clientId: authorized.clientId, ownerUserId: authorized.ownerUserId };
    return this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      const folder = await this.reloadFolder(tx, folderId);
      // Collected UNDER the lock, so no folder can be added to the subtree
      // between this read and the sweep below.
      const ids = await this.collectSubtree(folder.id, tx);
      const now = new Date();
      // Folders FIRST, then their files: trashing the folder rows takes their
      // row locks before the file sweep. A resumable-upload commit reads its
      // folder FOR SHARE, so either it waits for this delete (then sees the
      // folder gone and relocates to the root), or this delete waits for it —
      // and the file sweep below then trashes the just-recorded file together
      // with its folder. Either way no live file is left stranded inside a
      // trashed folder.
      await tx.databankFolder.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.databankFile.updateMany({
        where: { folderId: { in: ids }, deletedAt: null },
        data: { deletedAt: now },
      });
      return { deletedFolders: ids.length };
    }, FOLDER_TXN);
  }

  /**
   * Get-or-create a dropped folder tree in ONE call (Databank Phase 1): every
   * path (relative to `parentFolderId`) resolves to a folder id, creating only
   * what is missing. Same-name folders are REUSED — never "(2)" — so dropping a
   * half-uploaded Drive folder again merges into what is already there, and a
   * retry returns the same ids. One lock, one read of the scope's folders, then
   * one insert per ≤1,000 new folders (was one ~540 ms POST per folder).
   */
  async ensureFolderPaths(
    dto: EnsureFolderPathsDto,
    user: RequestUser,
    department: DatabankDepartment,
    targetUserId?: string,
  ) {
    const { clientId, ownerUserId } = await this.resolveWriteScope(dto, user, targetUserId);
    const scope = { clientId, ownerUserId };
    // Reject malformed paths before touching the database — naming the path,
    // so the officer can find the folder to rename in a 2,000-folder drop.
    for (const path of dto.paths) {
      try {
        splitFolderPath(path);
      } catch (e) {
        if (!(e instanceof FolderPathError)) throw e;
        const shown = path.length > 80 ? `${path.slice(0, 77)}...` : path;
        throw new BadRequestException(`${e.message} (folder ${JSON.stringify(shown)})`);
      }
    }
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockFolderScope(tx, scope);
        const base = await this.assertFolderInScope(dto.parentFolderId, scope, tx);
        const existing = await tx.databankFolder.findMany({
          where: { ...scope, deletedAt: null },
          select: { id: true, parentFolderId: true, name: true, createdAt: true },
        });
        let plan: FolderPlan;
        try {
          plan = planFolderPaths(base, dto.paths, existing, randomUUID);
        } catch (e) {
          if (e instanceof FolderPathError) throw new BadRequestException(e.message);
          throw e;
        }
        // Ids are minted up front, so no read-back is needed. Parents precede
        // their children in `create`, and each chunk's foreign keys are checked
        // at the end of its INSERT — a parent in the same or an earlier chunk.
        for (let i = 0; i < plan.create.length; i += 1000) {
          await tx.databankFolder.createMany({
            data: plan.create.slice(i, i + 1000).map((f) => ({ ...f, ...scope, department, createdByUserId: user.id })),
          });
        }
        return { folders: plan.folders, created: plan.create.length };
      },
      FOLDER_TXN,
    );
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Direct-to-storage upload (large files → R2, bypassing the backend)
  // ---------------------------------------------------------------------------

  /** Resolve a direct upload's scope (client vs personal) and AUTHORIZE the
   *  write in one place, returning the DB scope + the storage folder the object
   *  lives under. Shared by presign and commit so both gate identically. */
  async resolveWriteScope(
    dto: { clientId?: string | null; personal?: boolean },
    user: RequestUser,
    targetUserId?: string,
  ): Promise<{ clientId: string | null; ownerUserId: string | null; storageFolder: string }> {
    if (dto.personal) {
      const ownerUserId = targetUserId ?? user.id;
      this.assertPersonalAccess(ownerUserId, user);
      return { clientId: null, ownerUserId, storageFolder: `databank/users/${ownerUserId}` };
    }
    if (!dto.clientId) {
      throw new BadRequestException('Provide either clientId or personal: true.');
    }
    await this.assertClientWriteAccess(dto.clientId, user);
    return { clientId: dto.clientId, ownerUserId: null, storageFolder: `databank/clients/${dto.clientId}` };
  }

  /**
   * Step 1 of a direct browser→R2 upload. Authorizes the write, validates the
   * file name / size / destination folder, and returns a presigned PUT URL the
   * browser uploads to WITHOUT the bytes passing through the backend. In dev
   * storage modes the strategy is 'proxy' and the client falls back to the
   * streaming multipart endpoint.
   */
  async presignDirectUpload(dto: PresignUploadDto, user: RequestUser, targetUserId?: string) {
    this.assertSafeFileName(dto.fileName);
    if (dto.fileSizeBytes > DatabankService.DIRECT_MAX_BYTES) {
      throw new BadRequestException(
        `File is larger than the ${Math.round(
          DatabankService.DIRECT_MAX_BYTES / (1024 * 1024 * 1024),
        )} GB per-file upload limit.`,
      );
    }
    const scope = await this.resolveWriteScope(dto, user, targetUserId);
    // Fail an out-of-scope / missing folder BEFORE the (large) upload starts.
    await this.assertFolderInScope(dto.folderId, {
      clientId: scope.clientId,
      ownerUserId: scope.ownerUserId,
    });
    const presigned = await this.storage.presignPutUrl(scope.storageFolder, dto.mimeType, dto.fileName);
    return { ...presigned, maxBytes: DatabankService.DIRECT_MAX_BYTES };
  }

  /**
   * The committed-key guard, shared by the direct-upload commit and the version
   * commit. The key must be EXACTLY what presign issues for `scope` —
   * "<storageFolder>/<uuid>.<ext>", one path segment — so no "..", no extra
   * segments, no other client's / associate's prefix. It also must NOT belong to
   * a resumable upload session (those have the same shape but are recorded ONLY
   * by that path, after full verification). Throws ForbiddenException otherwise.
   */
  private async assertCommittableKey(
    storageKey: string,
    scope: { storageFolder: string },
  ): Promise<void> {
    const folderRe = scope.storageFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyShape = new RegExp(`^${folderRe}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[^/]*$`);
    if (!keyShape.test(storageKey)) {
      throw new ForbiddenException('This upload key does not belong to the target databank.');
    }
    const sessionOwned = await this.prisma.databankUpload.findUnique({
      where: { storageKey },
      select: { id: true },
    });
    if (sessionOwned) {
      throw new ForbiddenException('This upload key belongs to a resumable upload.');
    }
  }

  /** True when a DatabankFileVersion row already owns this storage key. Create
   *  paths (commitDirectUpload) must consult this because DatabankFileVersion and
   *  DatabankFile each have their OWN @unique(storageKey) — one key can legally
   *  exist once in each table, so a version-owned object could otherwise be adopted
   *  as a second file's mirror and freed out from under the version on purge.
   *  Accepts the prisma client or a tx so the caller can re-read inside a txn. */
  private async isVersionOwnedKey(
    db: Pick<Prisma.TransactionClient, 'databankFileVersion'>,
    storageKey: string,
  ): Promise<boolean> {
    const owner = await db.databankFileVersion.findUnique({ where: { storageKey }, select: { id: true } });
    return !!owner;
  }

  /**
   * HEAD a freshly-PUT object to prove it landed and capture its true size, then
   * enforce the single-PUT cap. A presigned PUT can't enforce size (R2 has no
   * POST policy), so a caller that skips the UI guard can store up to R2's 5 GiB
   * single-PUT limit — check the REAL stored size: absent → 400 (retry), over
   * cap → remove the object (best-effort) + 400. Returns the head meta so the
   * caller stores the true size. Shared by the direct-upload commit and the
   * version commit.
   */
  private async headWithinCap(storageKey: string) {
    const head = await this.storage.headObjectMeta(storageKey);
    if (!head.exists) {
      throw new BadRequestException(
        'The upload was not found in storage — it may not have finished. Please retry.',
      );
    }
    if ((head.sizeBytes ?? 0) > DatabankService.DIRECT_MAX_BYTES) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw new BadRequestException(
        `File is larger than the ${Math.round(
          DatabankService.DIRECT_MAX_BYTES / (1024 * 1024 * 1024),
        )} GB per-file upload limit.`,
      );
    }
    return head;
  }

  /**
   * Step 2 of a direct upload: the browser finished PUTting to `storageKey`, so
   * record the DatabankFile row. Re-authorizes the write, confirms the key
   * belongs to THIS scope's storage folder (a caller can't commit an arbitrary
   * or other-client key), and HEADs the object to prove it landed + capture its
   * true size before creating the row.
   */
  async commitDirectUpload(
    dto: CommitUploadDto,
    user: RequestUser,
    department: DatabankDepartment,
    targetUserId?: string,
  ) {
    this.assertSafeFileName(dto.fileName);
    const scope = await this.resolveWriteScope(dto, user, targetUserId);
    // The key must be EXACTLY what presign issues for this scope, and must not
    // belong to a resumable upload session (factored out — see assertCommittableKey).
    await this.assertCommittableKey(dto.storageKey, scope);
    // A key backs at most ONE file row. A retried commit (the first response was
    // lost) gets the row it already created instead of a duplicate; any other
    // reuse is refused — and never reaches the size-check delete below, so an
    // object a row still references can't be removed.
    const existing = await this.prisma.databankFile.findFirst({
      where: { storageKey: dto.storageKey },
      select: { id: true, clientId: true, ownerUserId: true, deletedAt: true },
    });
    if (existing) {
      const sameScope =
        existing.clientId === scope.clientId && existing.ownerUserId === scope.ownerUserId;
      if (sameScope && !existing.deletedAt) {
        return this.prisma.databankFile.findUniqueOrThrow({
          where: { id: existing.id },
          select: this.fileSelect,
        });
      }
      throw new BadRequestException('This upload has already been used.');
    }
    // A VERSION row can ALSO own a key — DatabankFileVersion.storageKey is a
    // SEPARATE unique from DatabankFile.storageKey, so the file-table guard above
    // is blind to it. A key that backs a version (e.g. a non-current version whose
    // file's mirror restoreVersion repointed away) must NEVER become a new file's
    // mirror: purging that new file would free an object another file's version
    // still references. Reject the replay. (Honest clients always commit a fresh
    // presigned UUID that no version row can own.)
    if (await this.isVersionOwnedKey(this.prisma, dto.storageKey)) {
      throw new BadRequestException('This upload has already been used.');
    }
    // Prove the object landed, capture its true size and enforce the single-PUT
    // cap (factored out — see headWithinCap).
    const head = await this.headWithinCap(dto.storageKey);
    const targetFolder = await this.assertFolderInScope(dto.folderId, {
      clientId: scope.clientId,
      ownerUserId: scope.ownerUserId,
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize against a concurrent subtree delete/purge of the destination
        // folder (see lockLiveDestinationFolder): if it is being trashed, the
        // row lands at the root instead of stranded inside a removed folder.
        const folderId = await this.lockLiveDestinationFolder(tx, targetFolder, {
          clientId: scope.clientId,
          ownerUserId: scope.ownerUserId,
        });
        // Defence-in-depth, re-read under the txn: refuse a key a version row owns
        // (a committed adoption between the pre-txn check and here is now visible).
        if (await this.isVersionOwnedKey(tx, dto.storageKey)) {
          throw new BadRequestException('This upload has already been used.');
        }
        return tx.databankFile.create({
          data: {
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
            folderId,
            fileName: dto.fileName,
            storageKey: dto.storageKey,
            mimeType: dto.mimeType,
            fileSizeBytes: head.sizeBytes ?? dto.fileSizeBytes,
            department,
            source: DatabankFileSource.UPLOAD,
            uploadedByUserId: user.id,
          },
          select: this.fileSelect,
        });
      }, FOLDER_TXN);
    } catch (e) {
      // Two commits of one key can overlap — a retry whose first reply was lost
      // while the server was still recording it — and both pass the look above.
      // storageKey is UNIQUE, so only one insert lands: the other gets its row
      // (same rules as the look above).
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const made = await this.prisma.databankFile.findFirst({
        where: { storageKey: dto.storageKey },
        select: { id: true, clientId: true, ownerUserId: true, deletedAt: true },
      });
      if (made && made.clientId === scope.clientId && made.ownerUserId === scope.ownerUserId && !made.deletedAt) {
        return this.prisma.databankFile.findUniqueOrThrow({ where: { id: made.id }, select: this.fileSelect });
      }
      throw new BadRequestException('This upload has already been used.');
    }
  }

  async uploadFile(
    clientId: string,
    file: Express.Multer.File | undefined,
    folderId: string | null | undefined,
    source: string | undefined,
    user: RequestUser,
    department: DatabankDepartment,
  ) {
    // The upload is written to a Multer temp file on disk (diskStorage), then
    // STREAMED to storage — never buffered whole in RAM — so large files (up
    // to the controller's 300 MB cap) don't pressure backend memory. We always
    // delete the temp file afterwards, success or failure.
    try {
      await this.assertClientWriteAccess(clientId, user);
      this.assertSafeFile(file);
      const targetFolder = await this.assertFolderInScope(folderId, { clientId, ownerUserId: null });

      // Only UPLOAD and CLIPBOARD are reachable through the upload endpoint;
      // COPIED / MIGRATED are set internally by copyFile / the migration script.
      const fileSource: DatabankFileSource =
        source === 'CLIPBOARD' ? DatabankFileSource.CLIPBOARD : DatabankFileSource.UPLOAD;

      const uploaded = await this.storage.uploadStreamFromFile(
        file!.path,
        file!.size,
        file!.mimetype,
        `databank/clients/${clientId}`,
        file!.originalname,
      );

      // Record the row under the per-folder serialization (FOR SHARE on the
      // destination) AFTER the stream, so a subtree delete/purge racing this
      // upload can't strand the new file inside a trashed folder — it lands at
      // the root instead. The lock is taken only for the quick insert, never
      // across the (possibly multi-second) stream above.
      return await this.prisma.$transaction(async (tx) => {
        const dest = await this.lockLiveDestinationFolder(tx, targetFolder, { clientId, ownerUserId: null });
        return tx.databankFile.create({
          data: {
            clientId,
            folderId: dest,
            fileName: file!.originalname,
            storageKey: uploaded.key,
            mimeType: file!.mimetype,
            fileSizeBytes: uploaded.sizeBytes,
            department,
            source: fileSource,
            uploadedByUserId: user.id,
          },
          select: this.fileSelect,
        });
      }, FOLDER_TXN);
    } finally {
      if (file?.path) await unlink(file.path).catch(() => undefined);
    }
  }

  /** Upload into an associate's PERSONAL databank (ownerUserId). Same disk-stream
   *  path as uploadFile; defaults to the caller, a manager may target another
   *  associate via targetUserId. */
  async uploadPersonalFile(
    user: RequestUser,
    file: Express.Multer.File | undefined,
    folderId: string | null | undefined,
    source: string | undefined,
    department: DatabankDepartment,
    targetUserId?: string,
  ) {
    try {
      const ownerUserId = targetUserId ?? user.id;
      this.assertPersonalAccess(ownerUserId, user);
      this.assertSafeFile(file);
      const targetFolder = await this.assertFolderInScope(folderId, { clientId: null, ownerUserId });

      const fileSource: DatabankFileSource =
        source === 'CLIPBOARD' ? DatabankFileSource.CLIPBOARD : DatabankFileSource.UPLOAD;

      const uploaded = await this.storage.uploadStreamFromFile(
        file!.path,
        file!.size,
        file!.mimetype,
        `databank/users/${ownerUserId}`,
        file!.originalname,
      );

      // Same per-folder serialization as uploadFile — land at the root rather
      // than strand the row inside a folder being trashed. Lock only for the
      // insert, never across the stream above.
      return await this.prisma.$transaction(async (tx) => {
        const dest = await this.lockLiveDestinationFolder(tx, targetFolder, { clientId: null, ownerUserId });
        return tx.databankFile.create({
          data: {
            ownerUserId,
            folderId: dest,
            fileName: file!.originalname,
            storageKey: uploaded.key,
            mimeType: file!.mimetype,
            fileSizeBytes: uploaded.sizeBytes,
            department,
            source: fileSource,
            uploadedByUserId: user.id,
          },
          select: this.fileSelect,
        });
      }, FOLDER_TXN);
    } finally {
      if (file?.path) await unlink(file.path).catch(() => undefined);
    }
  }

  /** A fresh, short-lived signed URL for viewing/downloading a file. Access is
   *  authorized here; the audit trail is written by the DocumentAccessAudit
   *  interceptor via @AuditDocumentAccess on the route. */
  async getSignedUrl(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.loadFileForRead(fileId, user, viewerDept);
    const url = await this.storage.getSignedUrl(file.storageKey);
    return { url, fileName: file.fileName, mimeType: file.mimeType };
  }

  async renameFile(fileId: string, fileName: string, user: RequestUser, viewerDept: DatabankDepartment) {
    // Same extension rule as upload — otherwise "scan.pdf" could be renamed to
    // "scan.exe" and slip past BLOCKED_EXT. Check the EXACT value we store.
    const name = fileName.trim();
    this.assertSafeFileName(name);
    const file = await this.loadFile(fileId, user, viewerDept);
    return this.prisma.databankFile.update({
      where: { id: file.id },
      data: { fileName: name },
      select: this.fileSelect,
    });
  }

  /**
   * Update a file's metadata — rename AND/OR set description/tags (Databank P2).
   * Every field is optional; a `fileName`-only body is exactly the old rename.
   * Tags are trimmed, empties dropped, de-duplicated and capped at 50; an
   * explicit `description: null` clears it. Reuses the SAME write-access check
   * as rename (loadFile → authorizeRow 'write'), so the file's scope decides who
   * may modify it. Returns fileSelect + description/tags so the UI reflects the
   * new metadata without a re-fetch.
   */
  async updateFile(fileId: string, dto: UpdateFileDto, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.loadFile(fileId, user, viewerDept);
    const data: Prisma.DatabankFileUpdateInput = {};
    if (dto.fileName !== undefined) {
      // Same extension rule as rename/upload — check the EXACT value we store.
      const name = dto.fileName.trim();
      this.assertSafeFileName(name);
      data.fileName = name;
    }
    if (dto.description !== undefined) {
      data.description = dto.description === null ? null : dto.description.trim();
    }
    if (dto.tags !== undefined) {
      data.tags = this.normalizeTags(dto.tags);
    }
    return this.prisma.databankFile.update({
      where: { id: file.id },
      data,
      select: { ...this.fileSelect, description: true, tags: true },
    });
  }

  /** Trim tags, drop empties, de-duplicate (first-seen wins) and cap at 50. */
  private normalizeTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
      const t = (raw ?? '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 50) break;
    }
    return out;
  }

  async moveFile(
    fileId: string,
    folderId: string | null | undefined,
    user: RequestUser,
    viewerDept: DatabankDepartment,
  ) {
    const file = await this.loadFile(fileId, user, viewerDept);
    const scope = { clientId: file.clientId, ownerUserId: file.ownerUserId };
    const targetFolder = await this.assertFolderInScope(folderId, scope);
    return this.prisma.$transaction(async (tx) => {
      // Serialize against a concurrent subtree delete/purge of the destination
      // (see lockLiveDestinationFolder): a move is a 4th path that reparents a
      // LIVE file into a folder, so without this it could strand the file inside
      // a folder being trashed — and the sweeper's FK cascade would then destroy
      // the live row. Relocate to the root if the folder was trashed meanwhile.
      const dest = await this.lockLiveDestinationFolder(tx, targetFolder, scope);
      return tx.databankFile.update({
        where: { id: file.id },
        data: { folderId: dest },
        select: this.fileSelect,
      });
    }, FOLDER_TXN);
  }

  /**
   * Copy a file — within the same client, or into another client's databank.
   * A TRUE copy: the bytes are duplicated to a fresh object key, so deleting
   * either copy never affects the other. The caller must be able to READ the
   * source file (any officer can) and WRITE the target client — a copy CREATES
   * a file in the target, so it is gated on the destination just like a direct
   * upload, whether the target is the same client or a different one.
   */
  async copyFile(
    fileId: string,
    dto: CopyFileDto,
    user: RequestUser,
    department: DatabankDepartment,
  ) {
    // The SOURCE is READ-gated with the COPYING portal's department as the viewer
    // (Processing/JR per-item separation): a JR copy can only read a Processing
    // source it has an active share to; a Processing copy never reads a JR source.
    const source = await this.loadFileForRead(fileId, user, department);

    // Resolve the target scope: an explicit targetClientId wins; otherwise copy
    // within the SOURCE's own scope (client → same client, personal → same owner).
    let targetClientId: string | null = null;
    let targetOwnerUserId: string | null = null;
    if (dto.targetClientId) targetClientId = dto.targetClientId;
    else if (source.clientId) targetClientId = source.clientId;
    else targetOwnerUserId = source.ownerUserId;

    // A copy CREATES a file in the target — gate on write of the destination.
    if (targetClientId) await this.assertClientWriteAccess(targetClientId, user);
    else if (targetOwnerUserId) this.assertPersonalAccess(targetOwnerUserId, user);
    else throw new BadRequestException('The file to copy has no client or owner.');

    const scope = { clientId: targetClientId, ownerUserId: targetOwnerUserId };
    const targetFolder = await this.assertFolderInScope(dto.targetFolderId, scope);
    const storageFolder = targetClientId
      ? `databank/clients/${targetClientId}`
      : `databank/users/${targetOwnerUserId}`;

    // A single server-side CopyObject is capped at 5 GiB on S3-compatible
    // storage (R2 included) — a bigger object needs a multipart UploadPartCopy
    // (planned). Refuse clearly up front instead of a storage 400 mid-request.
    if (Number(source.fileSizeBytes ?? 0) > DatabankService.COPY_MAX_BYTES) {
      throw new BadRequestException(
        'Files larger than 5 GB can’t be copied yet — download and re-upload it instead.',
      );
    }

    return this.copyOneFile(source, scope, targetFolder, storageFolder, user, department);
  }

  /**
   * Duplicate ONE file's bytes to a fresh storage key and insert its row. The
   * byte copy is a server-side CopyObject (never through the backend, so no
   * RAM), and the row insert runs in its OWN short transaction that takes a
   * FOR SHARE lock on the live destination folder (lockLiveDestinationFolder):
   * the slow copy widens the window in which the folder could be trashed, so
   * without the lock the live copy could be stranded inside a trashed folder and
   * destroyed by the sweeper's FK cascade — it falls back to the root instead.
   *
   * CONTRACT: callers MUST have already READ-authorized the source,
   * WRITE-authorized `scope` (the destination) and size-checked the file
   * (≤ COPY_MAX_BYTES). Kept OUTSIDE any scope-wide advisory lock so a bulk
   * copyFolder never holds the folder-structure lock across slow byte copies.
   */
  private async copyOneFile(
    source: {
      id: string;
      storageKey: string;
      fileName: string;
      mimeType: string | null;
      fileSizeBytes: bigint | null;
      sha256: string | null;
    },
    scope: { clientId: string | null; ownerUserId: string | null },
    destFolderId: string | null,
    storageFolder: string,
    user: RequestUser,
    department: DatabankDepartment,
  ) {
    const uploaded = await this.storage.copyObject(
      source.storageKey,
      storageFolder,
      Number(source.fileSizeBytes ?? 0),
      source.mimeType ?? 'application/octet-stream',
      source.fileName,
    );
    return this.prisma.$transaction(async (tx) => {
      const dest = await this.lockLiveDestinationFolder(tx, destFolderId, scope);
      return tx.databankFile.create({
        data: {
          clientId: scope.clientId,
          ownerUserId: scope.ownerUserId,
          folderId: dest,
          fileName: source.fileName,
          storageKey: uploaded.key,
          mimeType: source.mimeType,
          fileSizeBytes: source.fileSizeBytes,
          sha256: source.sha256, // same bytes → same hash (duplicate detection)
          department, // the COPYING portal's department, not the source row's
          source: DatabankFileSource.COPIED,
          copiedFromFileId: source.id,
          uploadedByUserId: user.id,
        },
        select: this.fileSelect,
      });
    }, FOLDER_TXN);
  }

  /**
   * Recursively copy a folder's whole LIVE subtree — every descendant folder is
   * recreated and every live file is byte-copied (server-side) into the new
   * tree. Gated like copyFile: READ the source, WRITE the destination (the same
   * scope, another client, or a personal area). Two phases:
   *   1. ONE fast LOCKED transaction recreates the folder skeleton (cycle guard,
   *      "(2)" suffix on a root-name clash, a belt re-count under the lock);
   *   2. file bytes + rows are copied OUTSIDE the lock, one short transaction
   *      per file, so the structure lock is never held across slow byte copies
   *      and each file row is relocate-on-trash safe (copyOneFile).
   * Files over 5 GB, or beyond the file ceiling, are SKIPPED and reported rather
   * than aborting the batch. A tree beyond the folder/depth ceilings is refused
   * up front, before anything is written.
   */
  async copyFolder(
    folderId: string,
    dto: CopyFolderDto,
    user: RequestUser,
    department: DatabankDepartment,
  ) {
    // The SOURCE is READ-gated with the COPYING portal's department as the viewer
    // (same per-item separation as copyFile): a JR folder-copy can only read a
    // Processing source it has an active share to.
    const source = await this.loadFolderForRead(folderId, user, department);

    // Resolve the target scope ONCE (explicit client wins; else the source's own
    // scope — client → same client, personal → same owner).
    let targetClientId: string | null = null;
    let targetOwnerUserId: string | null = null;
    if (dto.targetClientId) targetClientId = dto.targetClientId;
    else if (source.clientId) targetClientId = source.clientId;
    else targetOwnerUserId = source.ownerUserId;

    // A copy CREATES rows in the target — gate on WRITE of the destination,
    // BEFORE reading the subtree or writing anything.
    if (targetClientId) await this.assertClientWriteAccess(targetClientId, user);
    else if (targetOwnerUserId) this.assertPersonalAccess(targetOwnerUserId, user);
    else throw new BadRequestException('The folder to copy has no client or owner.');

    const scope = { clientId: targetClientId, ownerUserId: targetOwnerUserId };
    const sourceScope = { clientId: source.clientId, ownerUserId: source.ownerUserId };
    const sameScope =
      scope.clientId === sourceScope.clientId && scope.ownerUserId === sourceScope.ownerUserId;
    const storageFolder = targetClientId
      ? `databank/clients/${targetClientId}`
      : `databank/users/${targetOwnerUserId}`;

    // Ceilings — fail fast, UNLOCKED, before any write. A too-big tree is refused
    // with advice to copy its subfolders individually.
    const ceilingIds = await this.collectSubtree(source.id);
    const ceilingRows = await this.prisma.databankFolder.findMany({
      where: { id: { in: ceilingIds }, ...sourceScope },
      select: { id: true, parentFolderId: true },
    });
    const ceilingFileCount = await this.prisma.databankFile.count({
      where: { folderId: { in: ceilingIds }, deletedAt: null, ...sourceScope },
    });
    const parentOf = new Map(ceilingRows.map((f) => [f.id, f.parentFolderId]));
    let maxDepth = 1;
    for (const f of ceilingRows) {
      let depth = 1;
      let cur: string | null | undefined = f.id;
      while (cur && cur !== source.id && depth <= DatabankService.MAX_COPY_DEPTH) {
        cur = parentOf.get(cur);
        depth += 1;
      }
      if (depth > maxDepth) maxDepth = depth;
    }
    if (
      ceilingIds.length > DatabankService.MAX_COPY_FOLDERS ||
      ceilingFileCount > DatabankService.MAX_COPY_FILES ||
      maxDepth > DatabankService.MAX_COPY_DEPTH
    ) {
      throw new BadRequestException(
        'This folder is too large to copy in one operation — copy its subfolders individually.',
      );
    }

    // Phase 1 — recreate the folder skeleton in ONE fast locked transaction.
    const { idMap, rootNewId, folderIds, copiedRoot } = await this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      // Copying within one scope: re-read the source under the lock so a
      // concurrent delete of it is seen before we build on it.
      if (sameScope) await this.reloadFolder(tx, source.id);
      const targetParent = await this.assertFolderInScope(dto.targetFolderId, scope, tx);
      await this.assertNoCycle(source.id, targetParent, tx, COPY_CYCLE_MSG);

      // Authoritative subtree snapshot UNDER the lock — the ONLY enumeration
      // Phase 2 uses. Nothing can be added to the subtree after this read.
      const ids = await this.collectSubtree(source.id, tx);
      // Belt: the subtree may have grown between the unlocked ceiling check and
      // here — rolls back cleanly (nothing committed yet).
      const lockedFileCount = await tx.databankFile.count({
        where: { folderId: { in: ids }, deletedAt: null, ...sourceScope },
      });
      if (lockedFileCount > DatabankService.MAX_COPY_FILES) {
        throw new BadRequestException(
          'This folder is too large to copy in one operation — copy its subfolders individually.',
        );
      }

      const rows = await tx.databankFolder.findMany({
        where: { id: { in: ids }, ...sourceScope },
        select: { id: true, name: true, parentFolderId: true },
      });
      const srcParentOf = new Map(rows.map((r) => [r.id, r.parentFolderId]));
      const nameOf = new Map(rows.map((r) => [r.id, r.name]));

      // Depth-sort parents-first (collectSubtree gives no order) so every
      // parent's NEW id exists before its children are created.
      const depthOf = (id: string): number => {
        let d = 0;
        let cur: string | null | undefined = id;
        while (cur && cur !== source.id) {
          cur = srcParentOf.get(cur) ?? null;
          d += 1;
        }
        return d;
      };
      const ordered = [...ids].sort((a, b) => depthOf(a) - depthOf(b));
      const map = new Map<string, string>();
      for (const id of ordered) map.set(id, randomUUID());

      // The root's name may clash with a live sibling in the destination; the
      // live source IS a genuine sibling, so excludeId is undefined → "(2)".
      const rootName = await this.uniqueFolderName(scope, targetParent, source.name, undefined, tx);

      const data = ordered.map((id) => {
        const srcParent = srcParentOf.get(id) ?? null;
        const newParent =
          id === source.id ? targetParent : srcParent ? map.get(srcParent) ?? targetParent : targetParent;
        return {
          id: map.get(id)!,
          clientId: scope.clientId,
          ownerUserId: scope.ownerUserId,
          parentFolderId: newParent,
          name: id === source.id ? rootName : nameOf.get(id) ?? 'Untitled',
          department, // the COPYING portal's department
          createdByUserId: user.id,
        };
      });
      for (let i = 0; i < data.length; i += 1000) {
        // eslint-disable-next-line no-await-in-loop
        await tx.databankFolder.createMany({ data: data.slice(i, i + 1000) });
      }

      const newRootId = map.get(source.id)!;
      const root = await tx.databankFolder.findUniqueOrThrow({
        where: { id: newRootId },
        select: { id: true, name: true, parentFolderId: true, createdAt: true, updatedAt: true },
      });
      return { idMap: map, rootNewId: newRootId, folderIds: ids, copiedRoot: root };
    }, FOLDER_TXN);

    // Phase 2 — copy file bytes + rows OUTSIDE the lock, SEQUENTIALLY. take:MAX+1
    // catches a subtree that grew past the ceiling after the snapshot (reported,
    // never stranded).
    const srcFiles = await this.prisma.databankFile.findMany({
      where: { folderId: { in: folderIds }, deletedAt: null, ...sourceScope },
      select: {
        id: true, folderId: true, fileName: true, storageKey: true,
        mimeType: true, fileSizeBytes: true, sha256: true,
      },
      take: DatabankService.MAX_COPY_FILES + 1,
    });
    const skipped: Array<{ fileName: string; reason: 'TOO_LARGE' | 'ERROR' | 'LIMIT'; sizeBytes?: number }> = [];
    let copiedFiles = 0;
    let done = 0;
    for (const file of srcFiles) {
      if (done >= DatabankService.MAX_COPY_FILES) {
        skipped.push({ fileName: file.fileName, reason: 'LIMIT' });
        continue;
      }
      done += 1;
      const destFolderId = (file.folderId && idMap.get(file.folderId)) || rootNewId;
      if (Number(file.fileSizeBytes ?? 0) > DatabankService.COPY_MAX_BYTES) {
        skipped.push({ fileName: file.fileName, reason: 'TOO_LARGE', sizeBytes: Number(file.fileSizeBytes) });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.copyOneFile(file, scope, destFolderId, storageFolder, user, department);
        copiedFiles += 1;
      } catch {
        skipped.push({ fileName: file.fileName, reason: 'ERROR' });
      }
    }

    return { folder: copiedRoot, copiedFolders: folderIds.length, copiedFiles, skipped };
  }

  /** Soft-delete a single file (recoverable; the object stays in storage). */
  async deleteFile(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.loadFile(fileId, user, viewerDept);
    await this.prisma.databankFile.update({
      where: { id: file.id },
      data: { deletedAt: new Date() },
    });
    return { id: file.id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Trash — list / restore / permanent purge (Databank P3)
  // ---------------------------------------------------------------------------
  //
  // Soft delete (deleteFolder / deleteFile) stamps deletedAt; these recover or
  // PERMANENTLY remove those rows. A purge is irreversible — it hard-deletes the
  // row(s) and frees the storage object(s) — so every purge path first proves the
  // target is TRASHED (deletedAt != null) and never touches a live row. Folder
  // restore/purge run under the SAME per-scope folder lock as deleteFolder so
  // they can't race the tree; files don't lock (like deleteFile / moveFile).

  /** Load a TRASHED folder (deletedAt != null) for a restore/purge, then
   *  authorize a WRITE on its scope. 404 if missing or still live — a live
   *  folder is never a trash target. */
  private async loadTrashedFolder(folderId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const folder = await this.prisma.databankFolder.findFirst({
      where: { id: folderId, deletedAt: { not: null } },
    });
    if (!folder) throw new NotFoundException('Folder not found in trash');
    await this.authorizeRow(folder, user, 'write', viewerDept, 'folder');
    return folder;
  }

  /** Load a TRASHED file (deletedAt != null) for a restore/purge, then authorize
   *  a WRITE on its scope. 404 if missing or still live. */
  private async loadTrashedFile(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.prisma.databankFile.findFirst({
      where: { id: fileId, deletedAt: { not: null } },
    });
    if (!file) throw new NotFoundException('File not found in trash');
    await this.authorizeRow(file, user, 'write', viewerDept, 'file');
    return file;
  }

  /** Re-read a TRASHED folder once its scope is locked (loadTrashedFolder ran
   *  before the lock — it may have been restored/purged meanwhile). */
  private async reloadTrashedFolder(tx: Prisma.TransactionClient, folderId: string) {
    const folder = await tx.databankFolder.findFirst({ where: { id: folderId, deletedAt: { not: null } } });
    if (!folder) throw new NotFoundException('Folder not found in trash');
    return folder;
  }

  /** Resolve + AUTHORIZE a trash scope for a READ (clientId → team-wide read,
   *  personal → the owner, or a manager). Exactly one of clientId / personal. */
  private async resolveTrashReadScope(
    user: RequestUser,
    params: { clientId?: string; personal?: boolean },
  ): Promise<{ clientId: string | null; ownerUserId: string | null }> {
    if (params.clientId && params.personal) {
      throw new BadRequestException('Provide either clientId or personal: true, not both.');
    }
    if (params.clientId) {
      await this.assertClientReadAccess(params.clientId, user);
      return { clientId: params.clientId, ownerUserId: null };
    }
    if (params.personal) {
      this.assertPersonalAccess(user.id, user);
      return { clientId: null, ownerUserId: user.id };
    }
    throw new BadRequestException('Provide either clientId or personal: true.');
  }

  /**
   * The TOP-LEVEL trashed items in one scope — what the user actually deleted,
   * not the whole cascade. A trashed folder is top-level when its parent is null
   * or is itself NOT trashed; a trashed file when its folder is null or NOT
   * trashed. (A subtree delete trashes descendants too; those are nested under
   * their trashed parent and are restored/purged WITH it, so they stay hidden
   * here.) Ordered by deletedAt desc; `originalParentName` is the live folder the
   * item sat in, when any.
   */
  async listTrash(user: RequestUser, params: { clientId?: string; personal?: boolean }) {
    const scope = await this.resolveTrashReadScope(user, params);
    const [folders, files] = await Promise.all([
      this.prisma.databankFolder.findMany({
        where: { ...scope, deletedAt: { not: null } },
        select: { id: true, name: true, parentFolderId: true, deletedAt: true },
      }),
      this.prisma.databankFile.findMany({
        where: { ...scope, deletedAt: { not: null } },
        select: { id: true, fileName: true, folderId: true, deletedAt: true, fileSizeBytes: true },
      }),
    ]);
    // A row is top-level only when its parent folder is live (or absent) — a
    // trashed descendant is hidden under its trashed parent.
    const trashedFolderIds = new Set(folders.map((f) => f.id));
    const topFolders = folders.filter((f) => !f.parentFolderId || !trashedFolderIds.has(f.parentFolderId));
    const topFiles = files.filter((f) => !f.folderId || !trashedFolderIds.has(f.folderId));

    // The (live) parent folder each top-level item will restore back into — a
    // label for the trash view. One lookup for every referenced live parent.
    const parentIds = [
      ...new Set(
        [...topFolders.map((f) => f.parentFolderId), ...topFiles.map((f) => f.folderId)].filter(
          (v): v is string => !!v,
        ),
      ),
    ];
    const parents = parentIds.length
      ? await this.prisma.databankFolder.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, name: true },
        })
      : [];
    const parentName = new Map(parents.map((p) => [p.id, p.name]));

    const items = [
      ...topFolders.map((f) => ({
        kind: 'folder' as const,
        id: f.id,
        name: f.name,
        deletedAt: f.deletedAt as Date,
        originalParentName: f.parentFolderId ? parentName.get(f.parentFolderId) ?? null : null,
      })),
      ...topFiles.map((f) => ({
        kind: 'file' as const,
        id: f.id,
        name: f.fileName,
        deletedAt: f.deletedAt as Date,
        sizeBytes: f.fileSizeBytes,
        originalParentName: f.folderId ? parentName.get(f.folderId) ?? null : null,
      })),
    ];
    items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
    return items;
  }

  /**
   * Restore a TRASHED folder (and its trashed subtree) to the databank. The
   * destination is the folder's original parent IF it still exists and is live,
   * otherwise the root — ancestors are NOT auto-restored. The name is
   * disambiguated among LIVE siblings in the destination. Runs under the
   * per-scope folder lock so it can't race a concurrent tree change.
   */
  async restoreFolder(folderId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const authorized = await this.loadTrashedFolder(folderId, user, viewerDept);
    const scope = { clientId: authorized.clientId, ownerUserId: authorized.ownerUserId };
    return this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      const folder = await this.reloadTrashedFolder(tx, folderId);
      // Restore under the original parent only while it is live; otherwise the
      // root. Never auto-restore an ancestor.
      let destination: string | null = null;
      if (folder.parentFolderId) {
        const parent = await tx.databankFolder.findFirst({
          where: {
            id: folder.parentFolderId,
            deletedAt: null,
            clientId: scope.clientId,
            ownerUserId: scope.ownerUserId,
          },
          select: { id: true },
        });
        destination = parent?.id ?? null;
      }
      const name = await this.uniqueFolderName(scope, destination, folder.name, folder.id, tx);
      // The WHOLE trashed subtree (collectSubtree only walks LIVE children, so it
      // would miss nested trashed folders — this un-stamps every trashed one).
      const ids = await this.collectSubtreeWithTrashed(folder.id, tx);
      await tx.databankFolder.updateMany({
        where: { id: { in: ids }, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      await tx.databankFile.updateMany({
        where: { folderId: { in: ids }, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return tx.databankFolder.update({
        where: { id: folder.id },
        data: { parentFolderId: destination, name },
        select: { id: true, name: true, parentFolderId: true, updatedAt: true },
      });
    }, FOLDER_TXN);
  }

  /** Restore a TRASHED file to its folder if that folder is live, else the root.
   *  Files allow duplicate names, so there is no rename. Runs under the per-scope
   *  folder lock — like restoreFolder/deleteFolder/purgeFolder — so the
   *  destination's live/trashed state is stable (no resurrecting into a folder
   *  being trashed, and no race with a purge freeing this file's bytes). A
   *  compare-and-set on deletedAt means a file purged since the load is a 404, not
   *  a 500. */
  async restoreFile(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.loadTrashedFile(fileId, user, viewerDept);
    const scope = { clientId: file.clientId, ownerUserId: file.ownerUserId };
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      let destination: string | null = null;
      if (file.folderId) {
        const folder = await tx.databankFolder.findFirst({
          where: { id: file.folderId, deletedAt: null, clientId: file.clientId, ownerUserId: file.ownerUserId },
          select: { id: true },
        });
        destination = folder?.id ?? null;
      }
      const res = await tx.databankFile.updateMany({
        where: { id: file.id, deletedAt: { not: null } },
        data: { deletedAt: null, folderId: destination },
      });
      if (res.count !== 1) throw new NotFoundException('File not found in trash');
      return file.id;
    }, FOLDER_TXN);
    return this.prisma.databankFile.findFirstOrThrow({ where: { id }, select: this.fileSelect });
  }

  /**
   * PERMANENTLY remove a TRASHED file: hard-delete the row inside a transaction
   * (a compare-and-set on deletedAt, so a live file — or one restored/purged
   * since the load — is never removed), then free its storage object AFTER the
   * commit. A storage failure leaves an orphan (reclaimed by retention) but never
   * rolls back the delete. DB delete FIRST, free storage AFTER.
   */
  async purgeFile(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.loadTrashedFile(fileId, user, viewerDept);
    const versionKeys = await this.prisma.$transaction(async (tx) => {
      // Capture this file's version keys BEFORE the delete: the FK
      // version.fileId → file ON DELETE CASCADE removes the version rows without
      // freeing their objects (P3-2 lifecycle invariant).
      const versions = await tx.databankFileVersion.findMany({
        where: { fileId: file.id },
        select: { storageKey: true },
      });
      const res = await tx.databankFile.deleteMany({
        where: { id: file.id, deletedAt: { not: null } },
      });
      if (res.count !== 1) throw new NotFoundException('File not found in trash');
      return versions.map((v) => v.storageKey);
    });
    // Free the DEDUPED set {file.storageKey} ∪ {version keys}. Once v1 is
    // materialised the current object lives in both the mirror and its version
    // row — dedupe frees it exactly once; every historical object frees once.
    await this.freeStorage(this.dedupeKeys([file.storageKey, ...versionKeys]));
    return { id: file.id, purged: true };
  }

  /**
   * PERMANENTLY remove a TRASHED folder and its subtree: in one transaction
   * (under the per-scope lock) capture every descendant file's storage key, then
   * hard-delete all descendant file rows and all folder rows; free the storage
   * AFTER the commit (best-effort). The folder MUST be trashed — a live folder is
   * never touched. Every file row has its OWN unique storageKey, so freeing a
   * purged object can never affect another row.
   */
  async purgeFolder(folderId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const authorized = await this.loadTrashedFolder(folderId, user, viewerDept);
    const scope = { clientId: authorized.clientId, ownerUserId: authorized.ownerUserId };
    const { freeKeys, folderCount, fileCount } = await this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      const folder = await this.reloadTrashedFolder(tx, folderId);
      const ids = await this.collectSubtreeWithTrashed(folder.id, tx);
      // Belt-and-braces: uploads now take FOR SHARE on their live destination
      // folder (lockLiveDestinationFolder), so a commit can no longer strand a
      // LIVE file inside a folder being trashed — there should be none here. Keep
      // the relocate anyway: if the invariant ever slipped, move a stray live
      // file to the root rather than let the folder delete FK-cascade (permanently
      // destroy) it. The user purged a TRASHED folder — never a live file.
      // restoreFile/restoreFolder hold this same scope lock, so they can't add or
      // resurrect one mid-purge.
      await tx.databankFile.updateMany({
        where: { folderId: { in: ids }, deletedAt: null },
        data: { folderId: null },
      });
      // Only TRASHED rows are ever hard-deleted, and storage is freed only for the
      // files this transaction actually removes.
      const trashed = await tx.databankFile.findMany({
        where: { folderId: { in: ids }, deletedAt: { not: null } },
        select: { id: true, storageKey: true },
      });
      const trashedIds = trashed.map((f) => f.id);
      // Capture the TRASHED files' version keys BEFORE the delete — the FK
      // version.fileId → file cascade removes version rows without freeing objects.
      const versions = trashedIds.length
        ? await tx.databankFileVersion.findMany({
            where: { fileId: { in: trashedIds } },
            select: { storageKey: true },
          })
        : [];
      // Files FIRST (FK folder → files), then the trashed folder rows.
      await tx.databankFile.deleteMany({ where: { id: { in: trashedIds } } });
      await tx.databankFolder.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
      return {
        // Free the DEDUPED union {file keys} ∪ {version keys}; each file's keys
        // are unique to it, so dedupe only collapses the current-object twin.
        freeKeys: this.dedupeKeys([...trashed.map((f) => f.storageKey), ...versions.map((v) => v.storageKey)]),
        folderCount: ids.length,
        fileCount: trashed.length,
      };
    }, FOLDER_TXN);
    await this.freeStorage(freeKeys);
    return { purgedFolders: folderCount, purgedFiles: fileCount };
  }

  /** Free storage objects best-effort, AFTER their rows are gone — a failure is
   *  logged (the orphan is reclaimed by the retention sweeper), never thrown, so
   *  it can't undo a committed DB delete. */
  private async freeStorage(storageKeys: string[]): Promise<void> {
    for (const key of storageKeys) {
      // eslint-disable-next-line no-await-in-loop
      await this.storage
        .delete(key)
        .catch((e) =>
          this.log.warn(`databank purge: freeing ${key} failed (orphan left for retention): ${(e as Error).message}`),
        );
    }
  }

  /** De-duplicate a set of storage keys (dropping empties) so the P3-2 "free the
   *  deduped set {file.storageKey} ∪ {version keys}" rule frees each object
   *  EXACTLY once: the current object is mirrored on the file AND owned by its
   *  materialised current-version row, so without this it would be freed twice. */
  private dedupeKeys(keys: (string | null | undefined)[]): string[] {
    return [...new Set(keys.filter((k): k is string => !!k))];
  }

  /** Free objects best-effort, but ONLY after re-confirming no live row still
   *  references the key. Used by deleteVersion, whose file stays LIVE: between its
   *  commit and this free a concurrent commitNewVersion could re-adopt the just-
   *  removed key (an adversarial key replay), and an unconditional free would then
   *  destroy the file's current bytes. (purgeFile / purgeFolder / the sweeper free
   *  keys of rows that are GONE and whose file is trashed→unreachable by a live
   *  commit, so they free directly.) */
  private async freeStorageIfUnreferenced(storageKeys: string[]): Promise<void> {
    for (const key of this.dedupeKeys(storageKeys)) {
      // eslint-disable-next-line no-await-in-loop
      const ver = await this.prisma.databankFileVersion.findUnique({ where: { storageKey: key }, select: { id: true } });
      if (ver) continue;
      // eslint-disable-next-line no-await-in-loop
      const file = await this.prisma.databankFile.findFirst({ where: { storageKey: key }, select: { id: true } });
      if (file) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.freeStorage([key]);
    }
  }

  // ---------------------------------------------------------------------------
  // File versions (Databank P3-2). A file keeps a history of its bytes. Every
  // stored object is owned by exactly ONE DatabankFileVersion row; the file's
  // mirror columns are a denormalised read-cache of the current version. Existing
  // files are "implicit v1" (currentVersionId NULL, no version rows) — the first
  // commitNewVersion lazily materialises v1, so there is NO data backfill. Every
  // mutation runs under the per-file advisory lock (lockFileVersions) + a
  // SELECT … FOR UPDATE on the file, and bumps versionSeq (the ETag) via a
  // guarded compare-and-set (If-Match → 412).
  // ---------------------------------------------------------------------------

  /** The scope + storage folder a file's objects live under (its OWN scope). */
  private fileScope(file: { clientId: string | null; ownerUserId: string | null }): {
    clientId: string | null;
    ownerUserId: string | null;
    storageFolder: string;
  } {
    return file.clientId
      ? { clientId: file.clientId, ownerUserId: null, storageFolder: `databank/clients/${file.clientId}` }
      : { clientId: null, ownerUserId: file.ownerUserId, storageFolder: `databank/users/${file.ownerUserId}` };
  }

  /** Parse an `If-Match` header into the expected versionSeq, or undefined when no
   *  precondition was sent. Accepts a weak/strong ETag (`W/"5"`, `"5"`) or a bare
   *  number; a value with no digits yields undefined (treated as no precondition). */
  private parseIfMatch(ifMatch?: string | null): number | undefined {
    if (ifMatch === undefined || ifMatch === null) return undefined;
    const m = String(ifMatch).match(/\d+/);
    if (!m) return undefined;
    const n = Number(m[0]);
    return Number.isInteger(n) ? n : undefined;
  }

  /**
   * Step 1 of a new-version upload: presign a PUT into the file's OWN scope folder.
   * `loadFile` 404s a missing/trashed file (can't version a trashed file) and
   * authorizes a WRITE. Same single-PUT cap + name rules as the direct upload.
   * Returns the same shape as presignDirectUpload ({ strategy, storageKey, url?,
   * headers?, maxBytes }).
   */
  async presignNewVersion(
    fileId: string,
    dto: PresignVersionDto,
    user: RequestUser,
    viewerDept: DatabankDepartment,
  ) {
    const file = await this.loadFile(fileId, user, viewerDept);
    const name = dto.fileName ?? file.fileName;
    this.assertSafeFileName(name);
    if (dto.fileSizeBytes > DatabankService.DIRECT_MAX_BYTES) {
      throw new BadRequestException(
        `File is larger than the ${Math.round(
          DatabankService.DIRECT_MAX_BYTES / (1024 * 1024 * 1024),
        )} GB per-file upload limit.`,
      );
    }
    const scope = this.fileScope(file);
    const presigned = await this.storage.presignPutUrl(scope.storageFolder, dto.mimeType, name);
    return { ...presigned, maxBytes: DatabankService.DIRECT_MAX_BYTES };
  }

  /**
   * Step 2 of a new-version upload: the browser finished PUTting to `dto.storageKey`,
   * so record a new current version. Materialises the implicit v1 on first use.
   * Frees NOTHING on success (the new object is owned by the new version, the
   * prior current by its materialised history row). A sha256 match vs the CURRENT
   * version is a no-op (the redundant object is deleted). See the design doc.
   */
  async commitNewVersion(
    fileId: string,
    dto: CommitVersionDto,
    user: RequestUser,
    viewerDept: DatabankDepartment,
    ifMatch?: string,
  ) {
    const file = await this.loadFile(fileId, user, viewerDept);
    const scope = this.fileScope(file);
    await this.assertCommittableKey(dto.storageKey, scope);

    // Version-aware idempotency FIRST. This exact key already a version row of
    // THIS file → a prior commit succeeded and its reply was lost: return the file
    // unchanged (the object is referenced — free nothing). Any OTHER file's version
    // key, or any DatabankFile's key, is a misuse → 400.
    const keyOwner = await this.prisma.databankFileVersion.findUnique({
      where: { storageKey: dto.storageKey },
      select: { fileId: true },
    });
    if (keyOwner) {
      if (keyOwner.fileId === fileId) {
        return this.prisma.databankFile.findUniqueOrThrow({ where: { id: fileId }, select: this.fileSelect });
      }
      throw new BadRequestException('This upload has already been used.');
    }
    const fileOwner = await this.prisma.databankFile.findFirst({
      where: { storageKey: dto.storageKey },
      select: { id: true },
    });
    if (fileOwner) throw new BadRequestException('This upload has already been used.');

    // Prove the object landed + capture its true size; over cap frees it + 400.
    const head = await this.headWithinCap(dto.storageKey);
    const sizeBytes = head.sizeBytes ?? dto.fileSizeBytes;
    const expectedSeq = this.parseIfMatch(ifMatch);

    return this.prisma.$transaction(async (tx) => {
      await this.lockFileVersions(tx, fileId);
      // In-txn version-aware idempotency UNDER THE LOCK. The pre-txn check above is
      // a TOCTOU: a CONCURRENT commit of the SAME key (a lost-reply/double-submit
      // retry of one presign+PUT) can land while we wait for the lock. Once a
      // version row owns dto.storageKey it is a LIVE/referenced object — never
      // delete it. If it's this file's version, the concurrent/retry commit already
      // succeeded → return the file unchanged. If another file's, it's misuse → 400.
      const adopted = await tx.databankFileVersion.findUnique({
        where: { storageKey: dto.storageKey },
        select: { fileId: true },
      });
      if (adopted) {
        if (adopted.fileId === fileId) {
          return tx.databankFile.findUniqueOrThrow({ where: { id: fileId }, select: this.fileSelect });
        }
        throw new BadRequestException('This upload has already been used.');
      }
      // SELECT … FOR UPDATE on the (live) file — serialises against deleteFile /
      // purge and reads the mirror under the lock so current can't move.
      const rows = await tx.$queryRaw<
        {
          id: string;
          storageKey: string;
          mimeType: string | null;
          fileSizeBytes: bigint | null;
          sha256: string | null;
          currentVersionId: string | null;
          versionSeq: number;
          uploadedByUserId: string | null;
          createdAt: Date;
        }[]
      >`
        SELECT "id", "storageKey", "mimeType", "fileSizeBytes", "sha256",
               "currentVersionId", "versionSeq", "uploadedByUserId", "createdAt"
          FROM "processing"."databank_files"
         WHERE "id" = ${fileId} AND "deletedAt" IS NULL
         FOR UPDATE`;
      const current = rows[0];
      // Delete our OWN just-uploaded object only when NO row references it — a
      // GLOBAL reference re-read, not just file X's mirror. lockFileVersions is
      // per-file, so a concurrent commit on ANOTHER file of the same client (a
      // same-key replay) can adopt dto.storageKey while we hold only THIS file's
      // lock; the top-of-txn `adopted` read is point-in-time and misses it. Re-read
      // under the txn (READ COMMITTED sees that committed adopt) so we can never
      // hard-delete another file's live current object; a genuinely unreferenced
      // orphan (our own upload) is still reclaimed. Mirrors freeStorageIfUnreferenced.
      const deleteOwnUpload = async () => {
        const ver = await tx.databankFileVersion.findUnique({
          where: { storageKey: dto.storageKey },
          select: { id: true },
        });
        if (ver) return;
        const owningFile = await tx.databankFile.findFirst({
          where: { storageKey: dto.storageKey },
          select: { id: true },
        });
        if (owningFile) return;
        await this.storage.delete(dto.storageKey).catch(() => undefined);
      };
      if (!current) {
        // Destination no longer exists / was trashed meanwhile: free our own
        // just-uploaded object and abort (mirrors commit()).
        await deleteOwnUpload();
        throw new NotFoundException('File not found');
      }
      if (expectedSeq !== undefined && expectedSeq !== current.versionSeq) {
        await deleteOwnUpload();
        throw new PreconditionFailedException('The file version history changed since you loaded it.');
      }
      // sha256 no-op gating vs the CURRENT version only (a null current never
      // matches, so a first version always lands). Holding the lock + FOR UPDATE,
      // current can't move between this compare and the delete.
      if (dto.sha256 && current.sha256 && dto.sha256 === current.sha256) {
        await deleteOwnUpload();
        return tx.databankFile.findUniqueOrThrow({ where: { id: fileId }, select: this.fileSelect });
      }
      // Materialise the implicit v1 from the file's mirror on first version.
      if (!current.currentVersionId) {
        await tx.databankFileVersion.create({
          data: {
            id: randomUUID(),
            fileId,
            versionNumber: 1,
            storageKey: current.storageKey,
            mimeType: current.mimeType,
            fileSizeBytes: current.fileSizeBytes,
            sha256: current.sha256,
            source: DatabankFileSource.UPLOAD,
            createdByUserId: current.uploadedByUserId,
            createdAt: current.createdAt,
          },
        });
      }
      const newVersionId = await this.insertNextVersion(tx, {
        fileId,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType,
        fileSizeBytes: sizeBytes,
        sha256: dto.sha256,
        createdByUserId: user.id,
      });
      // Repoint current + mirror the new bytes; guarded compare-and-set on the
      // versionSeq read under the lock (If-Match already checked) → 412 on 0 rows.
      const updated = await tx.databankFile.updateMany({
        where: { id: fileId, versionSeq: current.versionSeq },
        data: {
          currentVersionId: newVersionId,
          storageKey: dto.storageKey,
          mimeType: dto.mimeType,
          fileSizeBytes: sizeBytes,
          sha256: dto.sha256,
          versionSeq: current.versionSeq + 1,
        },
      });
      if (updated.count !== 1) {
        throw new PreconditionFailedException('The file version history changed since you loaded it.');
      }
      return tx.databankFile.findUniqueOrThrow({ where: { id: fileId }, select: this.fileSelect });
    }, FOLDER_TXN);
  }

  /** INSERT the next version (versionNumber = max+1) under the already-held
   *  per-file lock. The @@unique([fileId, versionNumber]) backstops any race: on
   *  P2002 re-read the max + retry. Returns the new version id. */
  private async insertNextVersion(
    tx: Prisma.TransactionClient,
    data: {
      fileId: string;
      storageKey: string;
      mimeType: string | null;
      fileSizeBytes: number | bigint | null;
      sha256: string | null;
      createdByUserId: string | null;
      name?: string | null;
      // P3 PR-2: the resumable version session's id (its idempotency home —
      // DatabankFileVersion.uploadSessionId is @unique). The direct path passes
      // nothing → null.
      uploadSessionId?: string | null;
    },
  ): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const agg = await tx.databankFileVersion.aggregate({
        where: { fileId: data.fileId },
        _max: { versionNumber: true },
      });
      const versionNumber = (agg._max.versionNumber ?? 0) + 1;
      const id = randomUUID();
      try {
        // eslint-disable-next-line no-await-in-loop
        await tx.databankFileVersion.create({
          data: {
            id,
            fileId: data.fileId,
            versionNumber,
            storageKey: data.storageKey,
            mimeType: data.mimeType,
            fileSizeBytes: data.fileSizeBytes,
            sha256: data.sha256,
            source: DatabankFileSource.UPLOAD,
            name: data.name ?? null,
            uploadSessionId: data.uploadSessionId ?? null,
            createdByUserId: data.createdByUserId,
          },
        });
        return id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new ConflictException('Could not number the new version — please retry.');
  }

  /**
   * Attach an already-uploaded, server-VERIFIED object as a NEW current version of
   * an existing file — the resumable (> 2 GB) version path (P3 PR-2). Runs INSIDE
   * the upload-service commit's $transaction (`tx`), under the per-file version
   * lock. Mirrors {@link commitNewVersion}'s core, minus presign/HEAD/If-Match
   * (the resumable engine already verified the object + its size in finalize).
   *
   *  1. Idempotency — this session already owns a version row (lost reply / claim
   *     takeover retry): return that file, do NOTHING else (the object is
   *     referenced — free nothing).
   *  2. Per-file version lock + SELECT … FOR UPDATE on the live target file.
   *  3. A gone target (trashed/removed mid-upload) → throw DatabankTargetFileGoneError
   *     (the caller fails the session and frees the homeless bytes).
   *  4. sha256 == the CURRENT version → no-op (noop:true): create NO version, leave
   *     the file unchanged; the caller frees the redundant object via twin-cleanup.
   *  5. Materialise the implicit v1 from the mirror on first use, then append vN
   *     (carrying uploadSessionId) and repoint current + mirror. versionSeq++ is a
   *     PLAIN update — the caller's session CAS guards takeover and the per-file
   *     lock serialises, so no versionSeq compare-and-set is needed here.
   *
   * No folder FOR SHARE / lockLiveDestinationFolder: a version attaches to an
   * EXISTING live file, never creates or reparents a file row, so the "no live file
   * stranded under a trashed folder" invariant can't be triggered.
   */
  async attachUploadedVersion(
    tx: Prisma.TransactionClient,
    input: {
      targetFileId: string;
      storageKey: string;
      mimeType: string | null;
      fileSizeBytes: number | bigint | null;
      sha256: string | null;
      createdByUserId: string | null;
      uploadSessionId: string;
    },
  ): Promise<{ file: Prisma.DatabankFileGetPayload<{ select: DatabankService['fileSelect'] }>; noop: boolean }> {
    // 1. Idempotency — this session already attached a version (a lost-reply /
    //    takeover retry). The object is referenced; return the file, free nothing.
    const already = await tx.databankFileVersion.findUnique({
      where: { uploadSessionId: input.uploadSessionId },
      select: { fileId: true },
    });
    if (already) {
      const file = await tx.databankFile.findUniqueOrThrow({ where: { id: already.fileId }, select: this.fileSelect });
      return { file, noop: false };
    }
    await this.lockFileVersions(tx, input.targetFileId);
    const rows = await tx.$queryRaw<
      {
        id: string;
        storageKey: string;
        mimeType: string | null;
        fileSizeBytes: bigint | null;
        sha256: string | null;
        currentVersionId: string | null;
        versionSeq: number;
        uploadedByUserId: string | null;
        createdAt: Date;
      }[]
    >`
      SELECT "id", "storageKey", "mimeType", "fileSizeBytes", "sha256",
             "currentVersionId", "versionSeq", "uploadedByUserId", "createdAt"
        FROM "processing"."databank_files"
       WHERE "id" = ${input.targetFileId} AND "deletedAt" IS NULL
       FOR UPDATE`;
    const current = rows[0];
    // The target was trashed/removed during the (possibly long) upload → fail the
    // session (the caller frees the now-homeless object).
    if (!current) throw new DatabankTargetFileGoneError();
    // sha256 no-op vs the CURRENT version only (a null current never matches, so a
    // first version always lands). Holding the lock + FOR UPDATE, current can't move.
    if (input.sha256 && current.sha256 && input.sha256 === current.sha256) {
      const file = await tx.databankFile.findUniqueOrThrow({ where: { id: input.targetFileId }, select: this.fileSelect });
      return { file, noop: true };
    }
    // Materialise the implicit v1 from the file's mirror on first version.
    if (!current.currentVersionId) {
      await tx.databankFileVersion.create({
        data: {
          id: randomUUID(),
          fileId: input.targetFileId,
          versionNumber: 1,
          storageKey: current.storageKey,
          mimeType: current.mimeType,
          fileSizeBytes: current.fileSizeBytes,
          sha256: current.sha256,
          source: DatabankFileSource.UPLOAD,
          createdByUserId: current.uploadedByUserId,
          createdAt: current.createdAt,
        },
      });
    }
    const newVersionId = await this.insertNextVersion(tx, {
      fileId: input.targetFileId,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      sha256: input.sha256,
      createdByUserId: input.createdByUserId,
      uploadSessionId: input.uploadSessionId,
    });
    // Repoint current + mirror the new bytes. PLAIN update (no versionSeq CAS): the
    // per-file lock serialises version ops and the caller's session CAS guards
    // takeover, so the current can't move underneath this.
    await tx.databankFile.updateMany({
      where: { id: input.targetFileId },
      data: {
        currentVersionId: newVersionId,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
        sha256: input.sha256,
        versionSeq: { increment: 1 },
      },
    });
    const file = await tx.databankFile.findUniqueOrThrow({ where: { id: input.targetFileId }, select: this.fileSelect });
    return { file, noop: false };
  }

  /**
   * Restore a past version as the current one — a REPOINT only. Verifies the
   * version belongs to the (live) file, honours If-Match, no-ops when it is
   * already current, else repoints currentVersionId + mirrors that version's byte
   * columns onto the file (versionSeq+1, guarded → 412). Creates / moves / frees
   * ZERO objects: every version object already exists and stays referenced.
   */
  async restoreVersion(
    fileId: string,
    versionId: string,
    user: RequestUser,
    viewerDept: DatabankDepartment,
    ifMatch?: string,
  ) {
    await this.loadFile(fileId, user, viewerDept);
    const expectedSeq = this.parseIfMatch(ifMatch);
    await this.prisma.$transaction(async (tx) => {
      await this.lockFileVersions(tx, fileId);
      const rows = await tx.$queryRaw<{ id: string; currentVersionId: string | null; versionSeq: number }[]>`
        SELECT "id", "currentVersionId", "versionSeq"
          FROM "processing"."databank_files"
         WHERE "id" = ${fileId} AND "deletedAt" IS NULL
         FOR UPDATE`;
      const file = rows[0];
      if (!file) throw new NotFoundException('File not found');
      const version = await tx.databankFileVersion.findFirst({
        where: { id: versionId, fileId },
        select: { id: true, storageKey: true, mimeType: true, fileSizeBytes: true, sha256: true },
      });
      if (!version) throw new NotFoundException('Version not found');
      if (expectedSeq !== undefined && expectedSeq !== file.versionSeq) {
        throw new PreconditionFailedException('The file version history changed since you loaded it.');
      }
      if (file.currentVersionId === versionId) return; // already current → idempotent no-op
      const updated = await tx.databankFile.updateMany({
        where: { id: fileId, versionSeq: file.versionSeq },
        data: {
          currentVersionId: versionId,
          storageKey: version.storageKey,
          mimeType: version.mimeType,
          fileSizeBytes: version.fileSizeBytes,
          sha256: version.sha256,
          versionSeq: file.versionSeq + 1,
        },
      });
      if (updated.count !== 1) {
        throw new PreconditionFailedException('The file version history changed since you loaded it.');
      }
    }, FOLDER_TXN);
    return this.prisma.databankFile.findFirstOrThrow({ where: { id: fileId }, select: this.fileSelect });
  }

  /**
   * PERMANENTLY remove a NON-CURRENT version to reclaim its storage. Refuses the
   * current version (409) and the implicit v1 (no deletable row → 404). Captures
   * the key BEFORE the delete, then frees it AFTER the commit — the deleted row
   * was the SOLE reference to that unique key, so no double-free / no freeing a
   * referenced object.
   */
  async deleteVersion(
    fileId: string,
    versionId: string,
    user: RequestUser,
    viewerDept: DatabankDepartment,
    ifMatch?: string,
  ) {
    await this.loadFile(fileId, user, viewerDept);
    const expectedSeq = this.parseIfMatch(ifMatch);
    const freedKey = await this.prisma.$transaction(async (tx) => {
      await this.lockFileVersions(tx, fileId);
      const rows = await tx.$queryRaw<{ id: string; currentVersionId: string | null; versionSeq: number }[]>`
        SELECT "id", "currentVersionId", "versionSeq"
          FROM "processing"."databank_files"
         WHERE "id" = ${fileId} AND "deletedAt" IS NULL
         FOR UPDATE`;
      const file = rows[0];
      if (!file) throw new NotFoundException('File not found');
      if (expectedSeq !== undefined && expectedSeq !== file.versionSeq) {
        throw new PreconditionFailedException('The file version history changed since you loaded it.');
      }
      const version = await tx.databankFileVersion.findFirst({
        where: { id: versionId, fileId },
        select: { id: true, storageKey: true },
      });
      if (!version) throw new NotFoundException('Version not found');
      // Cannot delete the current version (also implicitly refuses an implicit v1,
      // which has no version row → the findFirst above already 404'd).
      if (file.currentVersionId === versionId) {
        throw new ConflictException('Cannot delete the current version — restore another version first.');
      }
      const res = await tx.databankFileVersion.deleteMany({ where: { id: versionId, fileId } });
      if (res.count !== 1) throw new NotFoundException('Version not found');
      await tx.databankFile.updateMany({
        where: { id: fileId, versionSeq: file.versionSeq },
        data: { versionSeq: file.versionSeq + 1 },
      });
      return version.storageKey;
    }, FOLDER_TXN);
    // Re-confirm nothing references the key before freeing: a concurrent
    // commitNewVersion replaying this key could have re-adopted it between the
    // commit above and this free (see freeStorageIfUnreferenced).
    await this.freeStorageIfUnreferenced([freedKey]);
    return { id: versionId, deleted: true };
  }

  /** Set a version's human label. versionSeq+1; If-Match honoured. */
  async renameVersion(
    fileId: string,
    versionId: string,
    name: string,
    user: RequestUser,
    viewerDept: DatabankDepartment,
    ifMatch?: string,
  ) {
    await this.loadFile(fileId, user, viewerDept);
    const label = (name ?? '').trim();
    const expectedSeq = this.parseIfMatch(ifMatch);
    await this.prisma.$transaction(async (tx) => {
      await this.lockFileVersions(tx, fileId);
      const rows = await tx.$queryRaw<{ versionSeq: number }[]>`
        SELECT "versionSeq"
          FROM "processing"."databank_files"
         WHERE "id" = ${fileId} AND "deletedAt" IS NULL
         FOR UPDATE`;
      const file = rows[0];
      if (!file) throw new NotFoundException('File not found');
      if (expectedSeq !== undefined && expectedSeq !== file.versionSeq) {
        throw new PreconditionFailedException('The file version history changed since you loaded it.');
      }
      const res = await tx.databankFileVersion.updateMany({
        where: { id: versionId, fileId },
        data: { name: label || null },
      });
      if (res.count !== 1) throw new NotFoundException('Version not found');
      await tx.databankFile.updateMany({
        where: { id: fileId, versionSeq: file.versionSeq },
        data: { versionSeq: file.versionSeq + 1 },
      });
    }, FOLDER_TXN);
    return this.listVersions(fileId, user, viewerDept);
  }

  /**
   * The version history, newest first. `etag` is W/"<versionSeq>" (the If-Match
   * basis). Materialised state: the row whose id == currentVersionId is current.
   * Implicit-v1 state (currentVersionId NULL, zero rows): a single SYNTHETIC
   * current entry from the file's mirror with id:null — the UI offers neither
   * restore nor delete on it (both apply only to non-current, materialised rows);
   * its bytes download via the file's own getSignedUrl.
   */
  async listVersions(fileId: string, user: RequestUser, viewerDept: DatabankDepartment) {
    const file = await this.loadFileForRead(fileId, user, viewerDept);
    const versions = await this.prisma.databankFileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        name: true,
        fileSizeBytes: true,
        mimeType: true,
        sha256: true,
        createdByUserId: true,
        createdAt: true,
      },
    });
    const etag = `W/"${file.versionSeq}"`;
    if (versions.length === 0 && !file.currentVersionId) {
      return {
        etag,
        versions: [
          {
            id: null,
            versionNumber: 1,
            name: null,
            fileSizeBytes: file.fileSizeBytes,
            mimeType: file.mimeType,
            sha256: file.sha256,
            createdByUserId: file.uploadedByUserId,
            createdAt: file.createdAt,
            isCurrent: true,
          },
        ],
      };
    }
    return {
      etag,
      versions: versions.map((v) => ({ ...v, isCurrent: v.id === file.currentVersionId })),
    };
  }

  /** A fresh signed URL for ONE version's bytes. Read-authorized; the audit trail
   *  is written by @AuditDocumentAccess on the route. */
  async getVersionSignedUrl(
    fileId: string,
    versionId: string,
    user: RequestUser,
    viewerDept: DatabankDepartment,
  ) {
    const file = await this.loadFileForRead(fileId, user, viewerDept);
    const version = await this.prisma.databankFileVersion.findFirst({
      where: { id: versionId, fileId },
      select: { storageKey: true, mimeType: true },
    });
    if (!version) throw new NotFoundException('Version not found');
    const url = await this.storage.getSignedUrl(version.storageKey);
    return { url, fileName: file.fileName, mimeType: version.mimeType };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  readonly fileSelect = {
    id: true, clientId: true, folderId: true, fileName: true, mimeType: true,
    fileSizeBytes: true, source: true, uploadedByUserId: true, createdAt: true, updatedAt: true,
    // P3-2: the UI shows a history affordance when currentVersionId is set and
    // holds versionSeq as the ETag for the optimistic-concurrency version ops.
    currentVersionId: true, versionSeq: true,
  } satisfies Prisma.DatabankFileSelect;

  private assertSafeFile(file: Express.Multer.File | undefined): void {
    if (!file) {
      throw new BadRequestException('No file provided. Use multipart/form-data with field name "file".');
    }
    this.assertSafeFileName(file.originalname);
  }

  /** Refuse an empty name or a blocked executable/script extension. Shared by
   *  the multipart upload (a real file) and the direct-upload presign/commit
   *  (only a file NAME, no bytes yet). */
  assertSafeFileName(fileName: string | undefined): void {
    if (!fileName || !fileName.trim()) {
      throw new BadRequestException('A file name is required.');
    }
    // Ignore trailing whitespace AND dots when reading the extension: "scan.exe "
    // and "scan.exe." both save/download as "scan.exe" (Windows drops trailing
    // dots), so they must hit BLOCKED_EXT too.
    const ext = (fileName.trim().replace(/[.\s]+$/, '').split('.').pop() ?? '').toLowerCase();
    if (DatabankService.BLOCKED_EXT.has(ext)) {
      throw new BadRequestException(`Files of type .${ext} are not allowed.`);
    }
  }

  /** Disambiguate a folder name within its parent, filesystem-style
   *  ("Passport" → "Passport (2)"). `excludeId` skips the folder being renamed. */
  private async uniqueFolderName(
    scope: { clientId: string | null; ownerUserId: string | null },
    parentFolderId: string | null,
    desired: string,
    excludeId?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string> {
    let name = desired;
    let n = 2;
    // eslint-disable-next-line no-await-in-loop
    while (
      await db.databankFolder.findFirst({
        where: {
          clientId: scope.clientId,
          ownerUserId: scope.ownerUserId,
          parentFolderId: parentFolderId ?? null,
          name,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      })
    ) {
      name = `${desired} (${n})`;
      n += 1;
    }
    return name;
  }

  /** Reject a move/copy that would put a folder inside its own subtree (a
   *  cycle). `message` lets the caller word the error for its operation (copy
   *  vs move); both throw sites use it so even a direct self-target is worded
   *  correctly. */
  private async assertNoCycle(
    folderId: string,
    newParentId: string | null,
    db: Prisma.TransactionClient = this.prisma,
    message = 'A folder cannot be moved into its own subtree',
  ): Promise<void> {
    if (!newParentId) return; // moving to root is always safe
    if (newParentId === folderId) {
      throw new BadRequestException(message);
    }
    // Walk the new parent's ancestor chain in ONE recursive query (was one
    // query per level — ~90 ms each to the Seoul DB). UNION de-duplicates, so
    // the walk terminates even if a race ever left a cycle in the data.
    const hit = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE anc AS (
        SELECT "id", "parentFolderId" FROM "processing"."databank_folders" WHERE "id" = ${newParentId}
        UNION
        SELECT f."id", f."parentFolderId"
          FROM "processing"."databank_folders" f
          JOIN anc ON f."id" = anc."parentFolderId"
      )
      SELECT "id" FROM anc WHERE "id" = ${folderId} LIMIT 1`;
    if (hit.length) {
      throw new BadRequestException(message);
    }
  }

  /** All live folder ids in a subtree, root included (breadth-first). */
  private async collectSubtree(
    rootId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string[]> {
    // The folder + all LIVE descendants in ONE recursive query (was one query
    // per folder: ~27 s for a 300-folder Drive-migrated client at ~90 ms per
    // round trip). Same semantics as before — the root is always included,
    // descendants only while not soft-deleted. UNION stops on any cycle.
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE sub AS (
        SELECT "id" FROM "processing"."databank_folders" WHERE "id" = ${rootId}
        UNION
        SELECT f."id"
          FROM "processing"."databank_folders" f
          JOIN sub ON f."parentFolderId" = sub."id"
         WHERE f."deletedAt" IS NULL
      )
      SELECT "id" FROM sub`;
    return rows.map((r) => r.id);
  }

  /** Every folder id in a subtree, root included, INCLUDING trashed descendants.
   *  collectSubtree stops at live children (its recursion filters deletedAt IS
   *  NULL), but a trashed subtree is entirely soft-deleted — restoring or purging
   *  it needs the whole thing. UNION stops on any cycle. */
  private async collectSubtreeWithTrashed(
    rootId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE sub AS (
        SELECT "id" FROM "processing"."databank_folders" WHERE "id" = ${rootId}
        UNION
        SELECT f."id"
          FROM "processing"."databank_folders" f
          JOIN sub ON f."parentFolderId" = sub."id"
      )
      SELECT "id" FROM sub`;
    return rows.map((r) => r.id);
  }
}
