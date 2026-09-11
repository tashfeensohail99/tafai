import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabankFileSource, Prisma } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RequestUser } from '../../../common/types/auth.types';
import { CopyFileDto, CreateFolderDto } from './databank.dto';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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

  // ---------------------------------------------------------------------------
  // Loaders (resolve owning client, then authorize)
  // ---------------------------------------------------------------------------

  /** Load a folder for a WRITE operation (rename / move / delete). */
  private async loadFolder(folderId: string, user: RequestUser) {
    const folder = await this.prisma.databankFolder.findFirst({
      where: { id: folderId, deletedAt: null },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.assertClientWriteAccess(folder.clientId, user);
    return folder;
  }

  /** Load a file for a WRITE operation (rename / move / delete). */
  private async loadFile(fileId: string, user: RequestUser) {
    const file = await this.prisma.databankFile.findFirst({
      where: { id: fileId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    await this.assertClientWriteAccess(file.clientId, user);
    return file;
  }

  /** Load a file for a READ operation (download / copy-from). Any processing
   *  user may read any client's file. */
  private async loadFileForRead(fileId: string, user: RequestUser) {
    const file = await this.prisma.databankFile.findFirst({
      where: { id: fileId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    await this.assertClientReadAccess(file.clientId, user);
    return file;
  }

  /** A folderId supplied by the caller must belong to the SAME client and be
   *  live. Prevents filing a client's document into another client's folder. */
  private async assertFolderInClient(
    folderId: string | null | undefined,
    clientId: string,
  ): Promise<string | null> {
    if (!folderId) return null;
    const folder = await this.prisma.databankFolder.findFirst({
      where: { id: folderId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new BadRequestException('Target folder does not exist for this client');
    return folder.id;
  }

  // ---------------------------------------------------------------------------
  // Browse
  // ---------------------------------------------------------------------------

  /** The full tree for one client: every live folder + file, flat. The client
   *  builds the hierarchy from parentFolderId / folderId — cheaper than a
   *  recursive query and trivial on the render side. */
  async getTree(clientId: string, user: RequestUser) {
    await this.assertClientReadAccess(clientId, user);
    const canWrite = await this.canWriteClient(clientId, user);
    const [folders, files] = await Promise.all([
      this.prisma.databankFolder.findMany({
        where: { clientId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, parentFolderId: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.databankFile.findMany({
        where: { clientId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, folderId: true, fileName: true, mimeType: true, fileSizeBytes: true,
          source: true, uploadedByUserId: true, createdAt: true, updatedAt: true,
        },
      }),
    ]);
    // canWrite tells the UI whether to show the edit controls: false = the
    // viewer may read/download but not modify (client assigned to another officer).
    return { clientId, folders, files, canWrite };
  }

  /** Clients for the cross-client landing page. Every processing user sees ALL
   *  clients (read-only on the ones not assigned to them — write is gated
   *  per-action). Each row carries its databank file count. */
  async listClients(user: RequestUser, q?: string) {
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { referenceCode: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: { id: true, referenceCode: true, firstName: true, lastName: true },
    });
    if (clients.length === 0) return [];

    const counts = await this.prisma.databankFile.groupBy({
      by: ['clientId'],
      where: { deletedAt: null, clientId: { in: clients.map((c) => c.id) } },
      _count: { _all: true },
    });
    const countByClient = new Map(counts.map((c) => [c.clientId, c._count._all]));

    return clients.map((c) => ({ ...c, fileCount: countByClient.get(c.id) ?? 0 }));
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
  async clientsByAssociate(user: RequestUser, q?: string) {
    const canAll = this.canViewAll(user);

    // Every processing user sees all associates' groups (read-only on the ones
    // not their own — write is gated per-action). `isSelf` surfaces their own.
    const where: Prisma.ProcessingCaseWhereInput = {
      assignedOfficerId: { not: null },
      client: { deletedAt: null },
    };
    const term = q?.trim();
    if (term) {
      const contains = { contains: term, mode: 'insensitive' as const };
      where.OR = [
        { client: { firstName: contains } },
        { client: { lastName: contains } },
        { client: { referenceCode: contains } },
        { assignedOfficer: { employee: { firstName: contains } } },
        { assignedOfficer: { employee: { lastName: contains } } },
      ];
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
      const counts = await this.prisma.databankFile.groupBy({
        by: ['clientId'],
        where: { deletedAt: null, clientId: { in: clientIds } },
        _count: { _all: true },
      });
      for (const c of counts) countByClient.set(c.clientId, c._count._all);
    }

    const byName = (a: ClientRow, b: ClientRow) =>
      `${a.firstName} ${a.lastName}`.trim().localeCompare(`${b.firstName} ${b.lastName}`.trim());

    const associates = [...groups.values()]
      .map((g) => ({
        officerId: g.officerId,
        officerName: g.officerName,
        isSelf: g.officerId === user.id,
        clientCount: g.clients.size,
        clients: [...g.clients.values()]
          .sort(byName)
          .map((c) => ({ ...c, fileCount: countByClient.get(c.id) ?? 0 })),
      }))
      .sort((a, b) => {
        // The viewer's own databank first, then alphabetical by associate name.
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        return a.officerName.localeCompare(b.officerName);
      });

    return { canSeeAll: canAll, viewerOfficerId: user.id, associates };
  }

  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------

  async createFolder(clientId: string, dto: CreateFolderDto, user: RequestUser) {
    await this.assertClientWriteAccess(clientId, user);
    const parentFolderId = await this.assertFolderInClient(dto.parentFolderId, clientId);
    const name = await this.uniqueFolderName(clientId, parentFolderId, dto.name.trim());

    return this.prisma.databankFolder.create({
      data: { clientId, parentFolderId, name, createdByUserId: user.id },
      select: { id: true, name: true, parentFolderId: true, createdAt: true, updatedAt: true },
    });
  }

  async renameFolder(folderId: string, name: string, user: RequestUser) {
    const folder = await this.loadFolder(folderId, user);
    const unique = await this.uniqueFolderName(
      folder.clientId, folder.parentFolderId, name.trim(), folder.id,
    );
    return this.prisma.databankFolder.update({
      where: { id: folder.id },
      data: { name: unique },
      select: { id: true, name: true, parentFolderId: true, updatedAt: true },
    });
  }

  async moveFolder(folderId: string, parentFolderId: string | null | undefined, user: RequestUser) {
    const folder = await this.loadFolder(folderId, user);
    const targetParent = await this.assertFolderInClient(parentFolderId, folder.clientId);
    await this.assertNoCycle(folder.id, targetParent);
    // A move can collide with an existing name in the destination — suffix it.
    const name = await this.uniqueFolderName(folder.clientId, targetParent, folder.name, folder.id);
    return this.prisma.databankFolder.update({
      where: { id: folder.id },
      data: { parentFolderId: targetParent, name },
      select: { id: true, name: true, parentFolderId: true, updatedAt: true },
    });
  }

  /** Soft-delete a folder and its ENTIRE subtree (descendant folders + all
   *  their files). Recoverable — nothing is removed from storage. */
  async deleteFolder(folderId: string, user: RequestUser) {
    const folder = await this.loadFolder(folderId, user);
    const ids = await this.collectSubtree(folder.id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.databankFile.updateMany({
        where: { folderId: { in: ids }, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.databankFolder.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);
    return { deletedFolders: ids.length };
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  async uploadFile(
    clientId: string,
    file: Express.Multer.File | undefined,
    folderId: string | null | undefined,
    source: string | undefined,
    user: RequestUser,
  ) {
    // The upload is written to a Multer temp file on disk (diskStorage), then
    // STREAMED to storage — never buffered whole in RAM — so large files (up
    // to the controller's 300 MB cap) don't pressure backend memory. We always
    // delete the temp file afterwards, success or failure.
    try {
      await this.assertClientWriteAccess(clientId, user);
      this.assertSafeFile(file);
      const targetFolder = await this.assertFolderInClient(folderId, clientId);

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

      return await this.prisma.databankFile.create({
        data: {
          clientId,
          folderId: targetFolder,
          fileName: file!.originalname,
          storageKey: uploaded.key,
          mimeType: file!.mimetype,
          fileSizeBytes: uploaded.sizeBytes,
          source: fileSource,
          uploadedByUserId: user.id,
        },
        select: this.fileSelect,
      });
    } finally {
      if (file?.path) await unlink(file.path).catch(() => undefined);
    }
  }

  /** A fresh, short-lived signed URL for viewing/downloading a file. Access is
   *  authorized here; the audit trail is written by the DocumentAccessAudit
   *  interceptor via @AuditDocumentAccess on the route. */
  async getSignedUrl(fileId: string, user: RequestUser) {
    const file = await this.loadFileForRead(fileId, user);
    const url = await this.storage.getSignedUrl(file.storageKey);
    return { url, fileName: file.fileName, mimeType: file.mimeType };
  }

  async renameFile(fileId: string, fileName: string, user: RequestUser) {
    const file = await this.loadFile(fileId, user);
    return this.prisma.databankFile.update({
      where: { id: file.id },
      data: { fileName: fileName.trim() },
      select: this.fileSelect,
    });
  }

  async moveFile(fileId: string, folderId: string | null | undefined, user: RequestUser) {
    const file = await this.loadFile(fileId, user);
    const targetFolder = await this.assertFolderInClient(folderId, file.clientId);
    return this.prisma.databankFile.update({
      where: { id: file.id },
      data: { folderId: targetFolder },
      select: this.fileSelect,
    });
  }

  /**
   * Copy a file — within the same client, or into another client's databank.
   * A TRUE copy: the bytes are duplicated to a fresh object key, so deleting
   * either copy never affects the other. The caller must be able to READ the
   * source file (any officer can) and WRITE the target client — a copy CREATES
   * a file in the target, so it is gated on the destination just like a direct
   * upload, whether the target is the same client or a different one.
   */
  async copyFile(fileId: string, dto: CopyFileDto, user: RequestUser) {
    const source = await this.loadFileForRead(fileId, user);
    const targetClientId = dto.targetClientId ?? source.clientId;
    await this.assertClientWriteAccess(targetClientId, user);
    const targetFolder = await this.assertFolderInClient(dto.targetFolderId, targetClientId);

    // Server-side copy: the bytes are duplicated inside storage and never pass
    // through the backend, so duplicating even a 300 MB file uses no RAM.
    const uploaded = await this.storage.copyObject(
      source.storageKey,
      `databank/clients/${targetClientId}`,
      source.fileSizeBytes ?? 0,
      source.mimeType ?? 'application/octet-stream',
      source.fileName,
    );

    return this.prisma.databankFile.create({
      data: {
        clientId: targetClientId,
        folderId: targetFolder,
        fileName: source.fileName,
        storageKey: uploaded.key,
        mimeType: source.mimeType,
        fileSizeBytes: source.fileSizeBytes,
        source: DatabankFileSource.COPIED,
        copiedFromFileId: source.id,
        uploadedByUserId: user.id,
      },
      select: this.fileSelect,
    });
  }

  /** Soft-delete a single file (recoverable; the object stays in storage). */
  async deleteFile(fileId: string, user: RequestUser) {
    const file = await this.loadFile(fileId, user);
    await this.prisma.databankFile.update({
      where: { id: file.id },
      data: { deletedAt: new Date() },
    });
    return { id: file.id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private readonly fileSelect = {
    id: true, clientId: true, folderId: true, fileName: true, mimeType: true,
    fileSizeBytes: true, source: true, uploadedByUserId: true, createdAt: true, updatedAt: true,
  } satisfies Prisma.DatabankFileSelect;

  private assertSafeFile(file: Express.Multer.File | undefined): void {
    if (!file) {
      throw new BadRequestException('No file provided. Use multipart/form-data with field name "file".');
    }
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (DatabankService.BLOCKED_EXT.has(ext)) {
      throw new BadRequestException(`Files of type .${ext} are not allowed.`);
    }
  }

  /** Disambiguate a folder name within its parent, filesystem-style
   *  ("Passport" → "Passport (2)"). `excludeId` skips the folder being renamed. */
  private async uniqueFolderName(
    clientId: string,
    parentFolderId: string | null,
    desired: string,
    excludeId?: string,
  ): Promise<string> {
    let name = desired;
    let n = 2;
    // eslint-disable-next-line no-await-in-loop
    while (
      await this.prisma.databankFolder.findFirst({
        where: {
          clientId,
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

  /** Reject a move that would put a folder inside its own subtree (a cycle). */
  private async assertNoCycle(folderId: string, newParentId: string | null): Promise<void> {
    if (!newParentId) return; // moving to root is always safe
    if (newParentId === folderId) {
      throw new BadRequestException('A folder cannot be moved into itself');
    }
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === folderId) {
        throw new BadRequestException('A folder cannot be moved into its own subtree');
      }
      // `currentId` + the explicit `parent` annotation break a circular type
      // inference: feeding the loop-reassigned `cursor` straight into Prisma's
      // generic findUnique makes TS try to infer `parent` from itself (TS7022).
      const currentId: string = cursor;
      // eslint-disable-next-line no-await-in-loop
      const parent: { parentFolderId: string | null } | null =
        await this.prisma.databankFolder.findUnique({
          where: { id: currentId },
          select: { parentFolderId: true },
        });
      cursor = parent?.parentFolderId ?? null;
    }
  }

  /** All live folder ids in a subtree, root included (breadth-first). */
  private async collectSubtree(rootId: string): Promise<string[]> {
    const ids = [rootId];
    const queue = [rootId];
    while (queue.length) {
      const current = queue.shift()!;
      // eslint-disable-next-line no-await-in-loop
      const children = await this.prisma.databankFolder.findMany({
        where: { parentFolderId: current, deletedAt: null },
        select: { id: true },
      });
      for (const child of children) {
        ids.push(child.id);
        queue.push(child.id);
      }
    }
    return ids;
  }
}
