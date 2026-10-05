import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabankDepartment, DatabankShareAccess } from '@prisma/client';
import { DatabankService } from './databank.service';
import { RequestUser } from '../../../common/types/auth.types';

/**
 * Processing/JR databank SHARE capability (Step 5) — a Processing MANAGER shares
 * a client (or one Processing folder) to JR, revokes a share, and lists the
 * active shares. These tests drive the REAL service methods (shareToJr /
 * unshareFromJr / listShares) end-to-end against a fake prisma; the manager gate
 * (canViewAll), the folder validation and the upsert-vs-create logic all run. No
 * DB.
 */

const C = 'client-1';
const OTHER = 'client-2';
const PROC = DatabankDepartment.PROCESSING;
const JR = DatabankDepartment.JR;

/** A Processing manager (processing.case.view_all) — the only role that may share. */
const MANAGER = { id: 'mgr', permissions: ['processing.case.view_all'] } as unknown as RequestUser;
/** A non-manager (officer) — may NOT grant/revoke. */
const OFFICER = { id: 'off', permissions: ['processing.case.view_assigned'] } as unknown as RequestUser;

type FolderRow = {
  id: string;
  clientId: string | null;
  department: DatabankDepartment;
  name: string;
  deletedAt: Date | null;
};

/** pf1 is a live Processing folder of C; jf1 is JR's; of1 belongs to OTHER;
 *  trashed1 is soft-deleted (so a folder share to it resolves no live name). */
const FOLDERS: FolderRow[] = [
  { id: 'pf1', clientId: C, department: PROC, name: 'Passport', deletedAt: null },
  { id: 'jf1', clientId: C, department: JR, name: 'JR Work', deletedAt: null },
  { id: 'of1', clientId: OTHER, department: PROC, name: 'Other client', deletedAt: null },
  { id: 'trashed1', clientId: C, department: PROC, name: 'Gone', deletedAt: new Date(0) },
];

type ShareRow = {
  id: string;
  clientId: string;
  folderId: string | null;
  fromDepartment: DatabankDepartment;
  toDepartment: DatabankDepartment;
  accessLevel: DatabankShareAccess;
  grantedByUserId: string;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const share = (over: Partial<ShareRow> & Pick<ShareRow, 'id'>): ShareRow => ({
  clientId: C,
  folderId: null,
  fromDepartment: PROC,
  toDepartment: JR,
  accessLevel: DatabankShareAccess.READ,
  grantedByUserId: MANAGER.id,
  revokedAt: null,
  revokedByUserId: null,
  note: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

/** A DatabankService over a fake prisma. `shares` is the mutable in-memory store,
 *  so create/update are observable through both the spies and the store. */
function harness(shares: ShareRow[] = []) {
  let seq = shares.length;
  const prisma = {
    client: {
      findFirst: jest.fn(async (args: { where: { id: string } }) =>
        args.where.id === C || args.where.id === OTHER ? { id: args.where.id } : null,
      ),
    },
    databankFolder: {
      findFirst: jest.fn(async (args: { where: { id: string; deletedAt?: unknown } }) =>
        FOLDERS.find((f) => f.id === args.where.id && f.deletedAt === null) ?? null,
      ),
      findMany: jest.fn(async (args: { where: { id: { in: string[] }; deletedAt?: unknown } }) =>
        FOLDERS.filter(
          (f) => args.where.id.in.includes(f.id) && f.deletedAt === null,
        ).map((f) => ({ id: f.id, name: f.name })),
      ),
    },
    databankShare: {
      findFirst: jest.fn(
        async (args: {
          where: {
            id?: string;
            clientId?: string;
            folderId?: string | null;
            toDepartment?: DatabankDepartment;
            revokedAt?: null;
          };
        }) => {
          const w = args.where;
          return (
            shares.find(
              (s) =>
                (w.id === undefined || s.id === w.id) &&
                (w.clientId === undefined || s.clientId === w.clientId) &&
                (w.folderId === undefined || s.folderId === w.folderId) &&
                (w.toDepartment === undefined || s.toDepartment === w.toDepartment) &&
                (w.revokedAt === undefined || s.revokedAt === w.revokedAt),
            ) ?? null
          );
        },
      ),
      findMany: jest.fn(
        async (args: {
          where: { clientId: string; toDepartment: DatabankDepartment; revokedAt: null };
          orderBy?: unknown;
        }) =>
          shares
            .filter(
              (s) =>
                s.clientId === args.where.clientId &&
                s.toDepartment === args.where.toDepartment &&
                s.revokedAt === null,
            )
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
      create: jest.fn(async (args: { data: Partial<ShareRow> }) => {
        const row = share({ id: `sh-${++seq}`, ...args.data } as ShareRow & { id: string });
        shares.push(row);
        return row;
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Partial<ShareRow> }) => {
        const row = shares.find((s) => s.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }),
    },
  };
  const storage = { getSignedUrl: jest.fn() };
  const svc = new DatabankService(prisma as never, storage as never);
  return { svc, prisma, shares };
}

describe('Databank sharing (Processing → JR) — Step 5', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('shareToJr', () => {
    it('manager shares the WHOLE client → creates an active JR share (default READ)', async () => {
      const { svc, prisma, shares } = harness([]);
      const out = await svc.shareToJr(C, {}, MANAGER);
      expect(prisma.databankShare.create).toHaveBeenCalledTimes(1);
      expect(prisma.databankShare.update).not.toHaveBeenCalled();
      expect(out).toMatchObject({
        clientId: C,
        folderId: null,
        fromDepartment: PROC,
        toDepartment: JR,
        accessLevel: DatabankShareAccess.READ,
        grantedByUserId: MANAGER.id,
      });
      expect(shares).toHaveLength(1);
    });

    it('manager shares ONE Processing folder → creates a folder share', async () => {
      const { svc, prisma } = harness([]);
      const out = await svc.shareToJr(C, { folderId: 'pf1', accessLevel: 'WRITE', note: 'escalated' }, MANAGER);
      expect(prisma.databankShare.create).toHaveBeenCalledTimes(1);
      expect(out).toMatchObject({
        clientId: C,
        folderId: 'pf1',
        toDepartment: JR,
        accessLevel: DatabankShareAccess.WRITE,
        note: 'escalated',
      });
    });

    it('sharing a JR-department folder → BadRequest', async () => {
      const { svc, prisma } = harness([]);
      await expect(svc.shareToJr(C, { folderId: 'jf1' }, MANAGER)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.databankShare.create).not.toHaveBeenCalled();
    });

    it('sharing a folder of ANOTHER client → BadRequest', async () => {
      const { svc, prisma } = harness([]);
      await expect(svc.shareToJr(C, { folderId: 'of1' }, MANAGER)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.databankShare.create).not.toHaveBeenCalled();
    });

    it('sharing a MISSING (or trashed) folder → BadRequest', async () => {
      const { svc } = harness([]);
      await expect(svc.shareToJr(C, { folderId: 'nope' }, MANAGER)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.shareToJr(C, { folderId: 'trashed1' }, MANAGER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a NON-manager (no processing.case.view_all) → Forbidden, no DB touched', async () => {
      const { svc, prisma } = harness([]);
      await expect(svc.shareToJr(C, {}, OFFICER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.findFirst).not.toHaveBeenCalled();
      expect(prisma.databankShare.create).not.toHaveBeenCalled();
    });

    it('re-sharing the SAME target UPDATES the existing active row (no duplicate)', async () => {
      const existing = share({ id: 'sh-1', folderId: null, accessLevel: DatabankShareAccess.READ });
      const { svc, prisma, shares } = harness([existing]);
      const out = await svc.shareToJr(C, { accessLevel: 'WRITE', note: 'now writable' }, MANAGER);
      expect(prisma.databankShare.update).toHaveBeenCalledTimes(1);
      expect(prisma.databankShare.create).not.toHaveBeenCalled();
      expect(shares).toHaveLength(1);
      expect(out).toMatchObject({ id: 'sh-1', accessLevel: DatabankShareAccess.WRITE, note: 'now writable' });
    });
  });

  describe('unshareFromJr', () => {
    it('revokes an active share — sets revokedAt + revokedByUserId', async () => {
      const row = share({ id: 'sh-1' });
      const { svc } = harness([row]);
      const out = await svc.unshareFromJr('sh-1', MANAGER);
      expect(out).toEqual({ id: 'sh-1', revoked: true });
      expect(row.revokedAt).toBeInstanceOf(Date);
      expect(row.revokedByUserId).toBe(MANAGER.id);
    });

    it('a non-manager → Forbidden', async () => {
      const { svc } = harness([share({ id: 'sh-1' })]);
      await expect(svc.unshareFromJr('sh-1', OFFICER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a missing share → NotFound', async () => {
      const { svc } = harness([]);
      await expect(svc.unshareFromJr('nope', MANAGER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an ALREADY-revoked share → NotFound', async () => {
      const { svc } = harness([share({ id: 'sh-1', revokedAt: new Date(0), revokedByUserId: MANAGER.id })]);
      await expect(svc.unshareFromJr('sh-1', MANAGER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listShares', () => {
    it('returns active shares with folderName + clientShared', async () => {
      const whole = share({ id: 'sh-whole', folderId: null, createdAt: new Date(1) });
      const folder = share({ id: 'sh-folder', folderId: 'pf1', accessLevel: DatabankShareAccess.WRITE, createdAt: new Date(2) });
      const revoked = share({ id: 'sh-old', folderId: 'pf1', revokedAt: new Date(0), createdAt: new Date(0) });
      const { svc } = harness([whole, folder, revoked]);

      const out = await svc.listShares(C, OFFICER); // any officer may read
      expect(out.clientShared).toBe(true);
      expect(out.shares).toHaveLength(2); // the revoked one is excluded
      expect(out.shares.map((s) => s.id)).toEqual(['sh-whole', 'sh-folder']);

      const wholeRow = out.shares.find((s) => s.id === 'sh-whole')!;
      expect(wholeRow).toMatchObject({ folderId: null, folderName: null, accessLevel: DatabankShareAccess.READ });
      expect(wholeRow.grantedByUserId).toBe(MANAGER.id);

      const folderRow = out.shares.find((s) => s.id === 'sh-folder')!;
      expect(folderRow).toMatchObject({ folderId: 'pf1', folderName: 'Passport', accessLevel: DatabankShareAccess.WRITE });
    });

    it('no active shares → clientShared false, empty list', async () => {
      const { svc } = harness([]);
      const out = await svc.listShares(C, MANAGER);
      expect(out).toEqual({ clientShared: false, shares: [] });
    });
  });
});
