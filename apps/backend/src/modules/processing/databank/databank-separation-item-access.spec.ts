import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabankDepartment, DatabankShareAccess } from '@prisma/client';
import { DatabankService } from './databank.service';

/**
 * Processing/JR databank PER-ITEM access by id (Step 4b), gated behind the
 * DATABANK_PORTAL_SEPARATION feature flag. These tests drive the REAL auth
 * chokepoint (authorizeRow + the loaders) end-to-end — assertClient*Access /
 * assertPersonalAccess / jrReadableProcessingScope / jrWriteCovers all run; only
 * prisma + storage are fakes. No DB.
 *
 * The invariant that makes the step safe: with the flag OFF (the default) a
 * per-item read/download/write behaves EXACTLY as before separation —
 * department-blind, no share logic. The department + share checks run ONLY when
 * the flag is ON.
 */

const ENV = 'DATABANK_PORTAL_SEPARATION';
const C = 'client-1';
/** A JR caller that may write the client (jr.matter.view_all) — so the OFF-path
 *  write regression and the ON WRITE-share path reach their mutations. */
const JR_USER = { id: 'jr1', permissions: ['jr.matter.view_all'] } as never;
/** A caller with no manager rights — for the personal non-owner check. */
const STRANGER = { id: 'stranger', permissions: [] } as never;

const PROC = DatabankDepartment.PROCESSING;
const JR = DatabankDepartment.JR;

type FileRow = {
  id: string;
  clientId: string | null;
  ownerUserId: string | null;
  department: DatabankDepartment;
  folderId: string | null;
  deletedAt: Date | null;
  fileName: string;
  storageKey: string;
  mimeType: string | null;
  fileSizeBytes: bigint | null;
  source: string;
  uploadedByUserId: string | null;
  currentVersionId: string | null;
  versionSeq: number;
  createdAt: Date;
  updatedAt: Date;
};

const f = (over: Partial<FileRow> & Pick<FileRow, 'id'>): FileRow => ({
  clientId: C,
  ownerUserId: null,
  department: PROC,
  folderId: null,
  deletedAt: null,
  fileName: 'doc.pdf',
  storageKey: `key-${over.id}`,
  mimeType: 'application/pdf',
  fileSizeBytes: BigInt(1),
  source: 'UPLOAD',
  uploadedByUserId: 'u1',
  currentVersionId: null,
  versionSeq: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

/** pf1 → pf1a is a Processing subtree; pf2 is a separate Processing folder; jf1
 *  is JR's own. Files sit as noted. */
const FOLDERS = [
  { id: 'pf1', parentFolderId: null, deletedAt: null as Date | null },
  { id: 'pf1a', parentFolderId: 'pf1', deletedAt: null as Date | null },
  { id: 'pf2', parentFolderId: null, deletedAt: null as Date | null },
  { id: 'jf1', parentFolderId: null, deletedAt: null as Date | null },
];
const FILES: FileRow[] = [
  f({ id: 'pInFolder', folderId: 'pf1' }), // Processing, inside the shareable folder
  f({ id: 'pInSub', folderId: 'pf1a' }), // Processing, inside pf1's subtree
  f({ id: 'pOutside', folderId: 'pf2' }), // Processing, in a DIFFERENT folder
  f({ id: 'jFile', department: JR, folderId: 'jf1' }), // JR's own
  f({ id: 'personal', clientId: null, ownerUserId: 'jr1', folderId: null }), // personal
];

type ShareRow = {
  id: string;
  clientId: string;
  folderId: string | null;
  toDepartment: DatabankDepartment;
  revokedAt: Date | null;
  accessLevel: DatabankShareAccess;
};

/** The LIVE subtree of a folder (root + live descendants) — the fake analogue of
 *  the recursive collectSubtree CTE. */
function subtreeIds(rootId: string): string[] {
  if (!FOLDERS.some((fo) => fo.id === rootId)) return [];
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const fo of FOLDERS) {
      if (fo.deletedAt === null && fo.parentFolderId && ids.has(fo.parentFolderId) && !ids.has(fo.id)) {
        ids.add(fo.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

/** A DatabankService on a fake prisma. The access model runs for real; shares are
 *  the per-test argument. storage.getSignedUrl returns a fixed URL. */
function harness(shares: ShareRow[]) {
  const prisma = {
    client: {
      findFirst: jest.fn(async (args: { where: { id: string } }) =>
        args.where.id === C ? { id: C } : null,
      ),
    },
    databankFile: {
      findFirst: jest.fn(async (args: { where: { id: string; deletedAt?: unknown } }) =>
        FILES.find((row) => row.id === args.where.id && row.deletedAt === null) ?? null,
      ),
      update: jest.fn(async (args: { where: { id: string } }) => ({ id: args.where.id })),
    },
    databankFolder: {
      findFirst: jest.fn(async (args: { where: { id: string } }) =>
        FOLDERS.find((row) => row.id === args.where.id && row.deletedAt === null) ?? null,
      ),
    },
    databankShare: {
      findMany: jest.fn(
        async (args: {
          where: {
            clientId: string;
            toDepartment: DatabankDepartment;
            revokedAt: null;
            accessLevel?: DatabankShareAccess;
          };
        }) =>
          shares.filter(
            (s) =>
              s.clientId === args.where.clientId &&
              s.toDepartment === args.where.toDepartment &&
              s.revokedAt === null &&
              (args.where.accessLevel === undefined || s.accessLevel === args.where.accessLevel),
          ),
      ),
    },
    processingCase: { count: jest.fn(async () => 0) },
    jrMatter: { count: jest.fn(async () => 0) },
    // collectSubtree runs a recursive CTE via $queryRaw as a TAGGED TEMPLATE.
    $queryRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => {
      const sqlText = Array.isArray(first) ? first.join(' ') : String((first as { sql?: string })?.sql ?? '');
      const values = Array.isArray(first) ? rest : ((first as { values?: unknown[] })?.values ?? []);
      if (sqlText.includes('RECURSIVE sub')) {
        return subtreeIds(String(values[0])).map((id) => ({ id }));
      }
      return [];
    }),
  };
  const storage = { getSignedUrl: jest.fn(async () => 'https://signed.example/obj') };
  const svc = new DatabankService(prisma as never, storage as never);
  return { svc, prisma, storage };
}

const wholeClient = (accessLevel: DatabankShareAccess): ShareRow => ({
  id: 'sh-all',
  clientId: C,
  folderId: null,
  toDepartment: JR,
  revokedAt: null,
  accessLevel,
});
const folderShare = (folderId: string, accessLevel: DatabankShareAccess): ShareRow => ({
  id: `sh-${folderId}`,
  clientId: C,
  folderId,
  toDepartment: JR,
  revokedAt: null,
  accessLevel,
});

describe('Databank separation — per-item access by id (feature-flagged)', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
    delete process.env[ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
    jest.restoreAllMocks();
  });

  describe('FLAG OFF — byte-identical to pre-separation (department/shares ignored)', () => {
    it('a JR caller may READ/download a Processing file by id (no share needed)', async () => {
      const { svc, storage } = harness([]); // zero shares — must be irrelevant when OFF
      const out = await svc.getSignedUrl('pInFolder', JR_USER, JR);
      expect(out.url).toBe('https://signed.example/obj');
      expect(storage.getSignedUrl).toHaveBeenCalledWith('key-pInFolder');
    });

    it('a JR caller may WRITE (delete) a Processing file by id', async () => {
      const { svc, prisma } = harness([]);
      await expect(svc.deleteFile('pInFolder', JR_USER, JR)).resolves.toEqual({ id: 'pInFolder', deleted: true });
      expect(prisma.databankFile.update).toHaveBeenCalledTimes(1);
    });

    it('a PROCESSING caller may read a JR-department file by id (department-blind)', async () => {
      const { svc } = harness([]);
      await expect(svc.getSignedUrl('jFile', JR_USER, PROC)).resolves.toMatchObject({
        url: 'https://signed.example/obj',
      });
    });
  });

  describe('FLAG ON — department scoping + JR share-in', () => {
    beforeEach(() => {
      process.env[ENV] = 'on';
    });

    it('JR download of an UNSHARED Processing file by id => NotFound (existence hidden)', async () => {
      const { svc, storage } = harness([]);
      await expect(svc.getSignedUrl('pInFolder', JR_USER, JR)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('JR download of a Processing file under a WHOLE-CLIENT share => allowed', async () => {
      const { svc, storage } = harness([wholeClient(DatabankShareAccess.READ)]);
      const out = await svc.getSignedUrl('pInFolder', JR_USER, JR);
      expect(out.url).toBe('https://signed.example/obj');
      expect(storage.getSignedUrl).toHaveBeenCalledWith('key-pInFolder');
    });

    it('JR download under a FOLDER share: a file INSIDE the shared subtree => allowed', async () => {
      const { svc } = harness([folderShare('pf1', DatabankShareAccess.READ)]);
      // pf1 itself and its descendant pf1a are both covered.
      await expect(svc.getSignedUrl('pInFolder', JR_USER, JR)).resolves.toMatchObject({ url: expect.any(String) });
      await expect(svc.getSignedUrl('pInSub', JR_USER, JR)).resolves.toMatchObject({ url: expect.any(String) });
    });

    it('JR download under a FOLDER share: a Processing file OUTSIDE the shared folder => NotFound', async () => {
      const { svc } = harness([folderShare('pf1', DatabankShareAccess.READ)]);
      await expect(svc.getSignedUrl('pOutside', JR_USER, JR)).rejects.toBeInstanceOf(NotFoundException);
      // A client-root Processing file is not under any folder share either.
      await expect(svc.getSignedUrl('pRoot', JR_USER, JR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('JR rename/move/delete of a shared-in (READ) Processing file => Forbidden (read-only)', async () => {
      const { svc, prisma } = harness([wholeClient(DatabankShareAccess.READ)]);
      await expect(svc.renameFile('pInFolder', 'renamed.pdf', JR_USER, JR)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.moveFile('pInFolder', 'pf2', JR_USER, JR)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.deleteFile('pInFolder', JR_USER, JR)).rejects.toBeInstanceOf(ForbiddenException);
      // The write never reached the DB.
      expect(prisma.databankFile.update).not.toHaveBeenCalled();
    });

    it('JR WRITE of a Processing file under a WHOLE-CLIENT WRITE share => allowed', async () => {
      const { svc, prisma } = harness([wholeClient(DatabankShareAccess.WRITE)]);
      await expect(svc.deleteFile('pInFolder', JR_USER, JR)).resolves.toEqual({ id: 'pInFolder', deleted: true });
      expect(prisma.databankFile.update).toHaveBeenCalledTimes(1);
    });

    it('a READ folder share does NOT grant write even inside its subtree => Forbidden', async () => {
      const { svc } = harness([folderShare('pf1', DatabankShareAccess.READ)]);
      await expect(svc.deleteFile('pInSub', JR_USER, JR)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PROCESSING caller accessing a JR-department file by id => NotFound', async () => {
      const { svc, storage } = harness([wholeClient(DatabankShareAccess.READ)]);
      await expect(svc.getSignedUrl('jFile', JR_USER, PROC)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('personal (ownerUserId) access is unchanged: the owner reads, a stranger is Forbidden', async () => {
      const { svc } = harness([]);
      await expect(svc.getSignedUrl('personal', JR_USER, JR)).resolves.toMatchObject({ url: expect.any(String) });
      await expect(svc.getSignedUrl('personal', STRANGER, JR)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
