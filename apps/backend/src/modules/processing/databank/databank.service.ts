import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabankFileSource, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RequestUser } from '../../../common/types/auth.types';
import {
  CommitUploadDto,
  CopyFileDto,
  CreateFolderDto,
  EnsureFolderPathsDto,
  PresignUploadDto,
} from './databank.dto';
import { FolderPathError, FolderPlan, planFolderPaths, splitFolderPath } from './folder-paths';

/** Folder-structure transactions (see lockFolderScope). Generous: a caller may
 *  queue behind a big first drop, which inserts thousands of rows ~90 ms away
 *  in the Seoul DB (Prisma's 5 s default would abort the waiter). */
const FOLDER_TXN = { timeout: 30_000 };


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
   *  owner-or-manager for both. */
  private async authorizeRow(
    row: { clientId: string | null; ownerUserId: string | null },
    user: RequestUser,
    mode: 'read' | 'write',
  ): Promise<void> {
    if (row.clientId) {
      if (mode === 'write') return this.assertClientWriteAccess(row.clientId, user);
      return this.assertClientReadAccess(row.clientId, user);
    }
    if (row.ownerUserId) return this.assertPersonalAccess(row.ownerUserId, user);
    throw new NotFoundException('Databank item is not attached to a client or an owner.');
  }

  // ---------------------------------------------------------------------------
  // Loaders (resolve the owning scope, then authorize)
  // ---------------------------------------------------------------------------

  /** Load a folder for a WRITE operation (rename / move / delete). */
  private async loadFolder(folderId: string, user: RequestUser) {
    const folder = await this.prisma.databankFolder.findFirst({
      where: { id: folderId, deletedAt: null },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.authorizeRow(folder, user, 'write');
    return folder;
  }

  /** Load a file for a WRITE operation (rename / move / delete). */
  private async loadFile(fileId: string, user: RequestUser) {
    const file = await this.prisma.databankFile.findFirst({
      where: { id: fileId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    await this.authorizeRow(file, user, 'write');
    return file;
  }

  /** Load a file for a READ operation (download / copy-from). Client files are
   *  readable team-wide; personal files only by the owner or a manager. */
  private async loadFileForRead(fileId: string, user: RequestUser) {
    const file = await this.prisma.databankFile.findFirst({
      where: { id: fileId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    await this.authorizeRow(file, user, 'read');
    return file;
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

  /** Clients for the cross-client landing page. Every processing user sees ALL
   *  clients (read-only on the ones not assigned to them — write is gated
   *  per-action). Each row carries its databank file count. */
  async listClients(user: RequestUser, q?: string) {
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
      const counts = await this.prisma.databankFile.groupBy({
        by: ['clientId'],
        where: { deletedAt: null, clientId: { in: clientIds } },
        _count: { _all: true },
      });
      for (const c of counts) { if (c.clientId) countByClient.set(c.clientId, c._count._all); }
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
  async listClientsForJr(_user: RequestUser, q?: string) {
    const matters = await this.prisma.jrMatter.findMany({
      select: { clientId: true },
    });
    const clientIds = [...new Set(matters.map((m) => m.clientId))];
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
  async clientsByAssociateForJr(user: RequestUser, q?: string) {
    const canAll = this.canSeeAllJr(user);
    const matters = await this.prisma.jrMatter.findMany({
      select: { clientId: true, assignedAssociateUserId: true },
    });
    if (matters.length === 0) {
      return { canSeeAll: canAll, viewerOfficerId: user.id, associates: [] };
    }

    const clientIds = [...new Set(matters.map((m) => m.clientId))];
    const associateIds = [
      ...new Set(matters.map((m) => m.assignedAssociateUserId).filter((v): v is string => !!v)),
    ];

    const [clients, users, counts] = await Promise.all([
      this.prisma.client.findMany({
        where: { id: { in: clientIds }, deletedAt: null },
        select: { id: true, referenceCode: true, firstName: true, lastName: true },
      }),
      this.prisma.userAccount.findMany({
        where: { id: { in: associateIds } },
        select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.databankFile.groupBy({
        by: ['clientId'],
        where: { deletedAt: null, clientId: { in: clientIds } },
        _count: { _all: true },
      }),
    ]);

    const clientById = new Map(clients.map((c) => [c.id, c]));
    const nameByUser = new Map(
      users.map((u) => {
        const emp = u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : '';
        return [u.id, emp || u.email];
      }),
    );
    const countByClient = new Map<string, number>();
    for (const c of counts) { if (c.clientId) countByClient.set(c.clientId, c._count._all); }

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
          .map((c) => ({ ...c, fileCount: countByClient.get(c.id) ?? 0 }));
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

  /** Re-read a folder once its scope is locked: loadFolder ran before the lock,
   *  so the folder may have been deleted meanwhile (its scope never changes). */
  private async reloadFolder(tx: Prisma.TransactionClient, folderId: string) {
    const folder = await tx.databankFolder.findFirst({ where: { id: folderId, deletedAt: null } });
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  async createFolder(clientId: string, dto: CreateFolderDto, user: RequestUser) {
    await this.assertClientWriteAccess(clientId, user);
    return this.createFolderIn({ clientId, ownerUserId: null }, dto, user);
  }

  /** Create a folder in an associate's PERSONAL databank (ownerUserId). Defaults
   *  to the caller's own; a manager may target another associate via targetUserId. */
  async createPersonalFolder(user: RequestUser, dto: CreateFolderDto, targetUserId?: string) {
    const ownerUserId = targetUserId ?? user.id;
    this.assertPersonalAccess(ownerUserId, user);
    return this.createFolderIn({ clientId: null, ownerUserId }, dto, user);
  }

  /** Create one folder in an already-AUTHORIZED scope ("Passport (2)" on a name
   *  clash — a hand-made folder is always new; ensure-paths is what merges). */
  private createFolderIn(
    scope: { clientId: string | null; ownerUserId: string | null },
    dto: CreateFolderDto,
    user: RequestUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockFolderScope(tx, scope);
      const parentFolderId = await this.assertFolderInScope(dto.parentFolderId, scope, tx);
      const name = await this.uniqueFolderName(scope, parentFolderId, dto.name.trim(), undefined, tx);
      return tx.databankFolder.create({
        data: { ...scope, parentFolderId, name, createdByUserId: user.id },
        select: { id: true, name: true, parentFolderId: true, createdAt: true, updatedAt: true },
      });
    }, FOLDER_TXN);
  }

  async renameFolder(folderId: string, name: string, user: RequestUser) {
    const authorized = await this.loadFolder(folderId, user);
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

  async moveFolder(folderId: string, parentFolderId: string | null | undefined, user: RequestUser) {
    const authorized = await this.loadFolder(folderId, user);
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
  async deleteFolder(folderId: string, user: RequestUser) {
    const authorized = await this.loadFolder(folderId, user);
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
  async ensureFolderPaths(dto: EnsureFolderPathsDto, user: RequestUser, targetUserId?: string) {
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
            data: plan.create.slice(i, i + 1000).map((f) => ({ ...f, ...scope, createdByUserId: user.id })),
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
   * Step 2 of a direct upload: the browser finished PUTting to `storageKey`, so
   * record the DatabankFile row. Re-authorizes the write, confirms the key
   * belongs to THIS scope's storage folder (a caller can't commit an arbitrary
   * or other-client key), and HEADs the object to prove it landed + capture its
   * true size before creating the row.
   */
  async commitDirectUpload(dto: CommitUploadDto, user: RequestUser, targetUserId?: string) {
    this.assertSafeFileName(dto.fileName);
    const scope = await this.resolveWriteScope(dto, user, targetUserId);
    // The key must be EXACTLY what presign issues for this scope —
    // "<storageFolder>/<uuid>.<ext>", one path segment — so no "..", no extra
    // segments, no other client's / associate's prefix.
    const folderRe = scope.storageFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyShape = new RegExp(`^${folderRe}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[^/]*$`);
    if (!keyShape.test(dto.storageKey)) {
      throw new ForbiddenException('This upload key does not belong to the target databank.');
    }
    // Keys of resumable upload sessions have the same shape, but they are
    // recorded ONLY by that path, after full verification — never here.
    const sessionOwned = await this.prisma.databankUpload.findUnique({
      where: { storageKey: dto.storageKey },
      select: { id: true },
    });
    if (sessionOwned) {
      throw new ForbiddenException('This upload key belongs to a resumable upload.');
    }
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
    const head = await this.storage.headObjectMeta(dto.storageKey);
    if (!head.exists) {
      throw new BadRequestException(
        'The upload was not found in storage — it may not have finished. Please retry.',
      );
    }
    // A presigned PUT can't enforce size (R2 has no POST policy), so a caller
    // that skips the UI guard can store up to R2's 5 GiB single-PUT limit.
    // Check the REAL stored size against this path's cap: over it, remove the
    // object (best-effort) and reject cleanly rather than keep an oversized,
    // non-resumable upload.
    if ((head.sizeBytes ?? 0) > DatabankService.DIRECT_MAX_BYTES) {
      await this.storage.delete(dto.storageKey).catch(() => undefined);
      throw new BadRequestException(
        `File is larger than the ${Math.round(
          DatabankService.DIRECT_MAX_BYTES / (1024 * 1024 * 1024),
        )} GB per-file upload limit.`,
      );
    }
    const targetFolder = await this.assertFolderInScope(dto.folderId, {
      clientId: scope.clientId,
      ownerUserId: scope.ownerUserId,
    });
    return this.prisma.databankFile.create({
      data: {
        clientId: scope.clientId,
        ownerUserId: scope.ownerUserId,
        folderId: targetFolder,
        fileName: dto.fileName,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType,
        fileSizeBytes: head.sizeBytes ?? dto.fileSizeBytes,
        source: DatabankFileSource.UPLOAD,
        uploadedByUserId: user.id,
      },
      select: this.fileSelect,
    });
  }

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

  /** Upload into an associate's PERSONAL databank (ownerUserId). Same disk-stream
   *  path as uploadFile; defaults to the caller, a manager may target another
   *  associate via targetUserId. */
  async uploadPersonalFile(
    user: RequestUser,
    file: Express.Multer.File | undefined,
    folderId: string | null | undefined,
    source: string | undefined,
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

      return await this.prisma.databankFile.create({
        data: {
          ownerUserId,
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
    // Same extension rule as upload — otherwise "scan.pdf" could be renamed to
    // "scan.exe" and slip past BLOCKED_EXT. Check the EXACT value we store.
    const name = fileName.trim();
    this.assertSafeFileName(name);
    const file = await this.loadFile(fileId, user);
    return this.prisma.databankFile.update({
      where: { id: file.id },
      data: { fileName: name },
      select: this.fileSelect,
    });
  }

  async moveFile(fileId: string, folderId: string | null | undefined, user: RequestUser) {
    const file = await this.loadFile(fileId, user);
    const targetFolder = await this.assertFolderInScope(folderId, {
      clientId: file.clientId,
      ownerUserId: file.ownerUserId,
    });
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
    const sizeBytes = Number(source.fileSizeBytes ?? 0);
    if (sizeBytes > DatabankService.COPY_MAX_BYTES) {
      throw new BadRequestException(
        'Files larger than 5 GB can’t be copied yet — download and re-upload it instead.',
      );
    }

    // Server-side copy: the bytes are duplicated inside storage and never pass
    // through the backend, so duplicating even a multi-GB file uses no RAM.
    const uploaded = await this.storage.copyObject(
      source.storageKey,
      storageFolder,
      sizeBytes,
      source.mimeType ?? 'application/octet-stream',
      source.fileName,
    );

    return this.prisma.databankFile.create({
      data: {
        clientId: targetClientId,
        ownerUserId: targetOwnerUserId,
        folderId: targetFolder,
        fileName: source.fileName,
        storageKey: uploaded.key,
        mimeType: source.mimeType,
        fileSizeBytes: source.fileSizeBytes,
        sha256: source.sha256, // same bytes → same hash (duplicate detection)
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

  readonly fileSelect = {
    id: true, clientId: true, folderId: true, fileName: true, mimeType: true,
    fileSizeBytes: true, source: true, uploadedByUserId: true, createdAt: true, updatedAt: true,
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

  /** Reject a move that would put a folder inside its own subtree (a cycle). */
  private async assertNoCycle(
    folderId: string,
    newParentId: string | null,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (!newParentId) return; // moving to root is always safe
    if (newParentId === folderId) {
      throw new BadRequestException('A folder cannot be moved into itself');
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
      throw new BadRequestException('A folder cannot be moved into its own subtree');
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
}
