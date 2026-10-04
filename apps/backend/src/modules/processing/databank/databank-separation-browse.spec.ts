import { DatabankDepartment } from '@prisma/client';
import { DatabankService } from './databank.service';

/**
 * Processing/JR databank DEPARTMENT-SCOPED BROWSING (Step 4a), gated behind the
 * DATABANK_PORTAL_SEPARATION feature flag.
 *
 * The invariant that makes the step safe: with the flag OFF (the default) every
 * read behaves exactly as before separation — the whole client's databank,
 * department-blind, with no shared/readOnly/department tags — regardless of the
 * viewer's department. The separation logic (department scoping + JR share-in)
 * runs ONLY when the flag is ON. Prisma is a fake; no DB.
 */

const ENV = 'DATABANK_PORTAL_SEPARATION';
const CLIENT = 'client-1';
const USER = { id: 'u1', permissions: [] } as never;

type Row = Record<string, unknown>;

/** A client databank with Processing + JR folders/files. pf1 → pf1a is a
 *  Processing subtree; pf2 is a separate Processing folder; jf1 is JR's own. */
const FOLDERS = [
  { id: 'pf1', name: 'Passport', parentFolderId: null, clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'pf1a', name: 'Scans', parentFolderId: 'pf1', clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'pf2', name: 'Other', parentFolderId: null, clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'jf1', name: 'JR Bundle', parentFolderId: null, clientId: CLIENT, department: DatabankDepartment.JR, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) },
];
const FILES = [
  { id: 'pfile1', folderId: 'pf1', fileName: 'p1.pdf', clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null, mimeType: 'application/pdf', fileSizeBytes: BigInt(1), source: 'UPLOAD', uploadedByUserId: 'u1', createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'pfile1a', folderId: 'pf1a', fileName: 'p1a.pdf', clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null, mimeType: 'application/pdf', fileSizeBytes: BigInt(1), source: 'UPLOAD', uploadedByUserId: 'u1', createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'pfile2', folderId: 'pf2', fileName: 'p2.pdf', clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null, mimeType: 'application/pdf', fileSizeBytes: BigInt(1), source: 'UPLOAD', uploadedByUserId: 'u1', createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'pfileRoot', folderId: null, fileName: 'proot.pdf', clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null, mimeType: 'application/pdf', fileSizeBytes: BigInt(1), source: 'UPLOAD', uploadedByUserId: 'u1', createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'jfile1', folderId: 'jf1', fileName: 'j1.pdf', clientId: CLIENT, department: DatabankDepartment.JR, deletedAt: null, mimeType: 'application/pdf', fileSizeBytes: BigInt(1), source: 'UPLOAD', uploadedByUserId: 'u1', createdAt: new Date(0), updatedAt: new Date(0) },
  { id: 'jfileRoot', folderId: null, fileName: 'jroot.pdf', clientId: CLIENT, department: DatabankDepartment.JR, deletedAt: null, mimeType: 'application/pdf', fileSizeBytes: BigInt(1), source: 'UPLOAD', uploadedByUserId: 'u1', createdAt: new Date(0), updatedAt: new Date(0) },
];

type ShareRow = { id: string; clientId: string; folderId: string | null; toDepartment: DatabankDepartment; revokedAt: Date | null };

function project(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

/** The LIVE subtree of a folder (root + live descendants) — the fake analogue of
 *  the recursive collectSubtree CTE. */
function subtreeIds(rootId: string): string[] {
  if (!FOLDERS.some((f) => f.id === rootId)) return [];
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of FOLDERS) {
      if (f.deletedAt === null && f.parentFolderId && ids.has(f.parentFolderId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

/** A DatabankService wired to a fake prisma that filters FOLDERS/FILES by the
 *  `where` getTree builds and expands folder shares through a stubbed recursive
 *  query. Auth + canWrite are stubbed (their own specs cover them). */
function treeHarness(shares: ShareRow[]) {
  const prisma = {
    databankShare: {
      findMany: jest.fn(async (args: { where: { clientId: string; toDepartment: DatabankDepartment; revokedAt: null } }) =>
        shares.filter(
          (s) =>
            s.clientId === args.where.clientId &&
            s.toDepartment === args.where.toDepartment &&
            s.revokedAt === null,
        ),
      ),
    },
    databankFolder: {
      findMany: jest.fn(async (args: { where: any; select?: Record<string, boolean> }) =>
        FOLDERS.filter((f) => matchFolder(f, args.where)).map((f) => project(f, args.select)),
      ),
    },
    databankFile: {
      findMany: jest.fn(async (args: { where: any; select?: Record<string, boolean> }) =>
        FILES.filter((f) => matchFile(f, args.where)).map((f) => project(f, args.select)),
      ),
    },
    // collectSubtree runs a recursive CTE via $queryRaw as a TAGGED TEMPLATE
    // (first arg is a TemplateStringsArray, then the interpolated values); return
    // the fake subtree for it. (A single-Sql call shape is handled too.)
    $queryRaw: jest.fn(async (first: any, ...rest: unknown[]) => {
      const sqlText = Array.isArray(first) ? first.join(' ') : String(first?.sql ?? '');
      const values = Array.isArray(first) ? rest : (first?.values ?? []);
      if (sqlText.includes('RECURSIVE sub')) {
        return subtreeIds(String(values[0])).map((id) => ({ id }));
      }
      return [];
    }),
  };
  const svc = new DatabankService(prisma as never, {} as never);
  const s = svc as any;
  s.assertClientReadAccess = jest.fn().mockResolvedValue(undefined);
  s.canWriteClient = jest.fn().mockResolvedValue(true);
  return { svc, prisma };
}

function matchFolder(f: (typeof FOLDERS)[number], where: any): boolean {
  if (where.deletedAt === null && f.deletedAt !== null) return false;
  if (where.clientId !== undefined && f.clientId !== where.clientId) return false;
  if (where.department !== undefined && f.department !== where.department) return false;
  if (where.id?.in && !where.id.in.includes(f.id)) return false;
  return true;
}
function matchFile(f: (typeof FILES)[number], where: any): boolean {
  if (where.deletedAt === null && f.deletedAt !== null) return false;
  if (where.clientId !== undefined && f.clientId !== where.clientId) return false;
  if (where.department !== undefined && f.department !== where.department) return false;
  if (where.folderId?.in && !where.folderId.in.includes(f.folderId)) return false;
  return true;
}

const ids = (rows: Row[]) => (rows as Array<{ id: string }>).map((r) => r.id).sort();
const byId = (rows: Row[]) => new Map((rows as Array<{ id: string }>).map((r) => [r.id, r as Row]));

describe('Databank separation — department-scoped browsing (feature-flagged)', () => {
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

  describe('FLAG OFF — byte-identical to pre-separation (viewerDept ignored)', () => {
    it('getTree returns the WHOLE client, untagged, regardless of viewerDept', async () => {
      const { svc } = treeHarness([]); // no shares — must be irrelevant when OFF
      const proc = await svc.getTree(CLIENT, USER, DatabankDepartment.PROCESSING);
      const jr = await svc.getTree(CLIENT, USER, DatabankDepartment.JR);

      // Both portals see every live folder + file, Processing AND JR.
      const allFolders = ['jf1', 'pf1', 'pf1a', 'pf2'];
      const allFiles = ['jfile1', 'jfileRoot', 'pfile1', 'pfile1a', 'pfile2', 'pfileRoot'];
      expect(ids(proc.folders)).toEqual(allFolders);
      expect(ids(jr.folders)).toEqual(allFolders);
      expect(ids(proc.files)).toEqual(allFiles);
      expect(ids(jr.files)).toEqual(allFiles);

      // No shared / readOnly / department tags are added when OFF.
      for (const r of [...jr.folders, ...jr.files, ...proc.folders, ...proc.files]) {
        expect('shared' in r).toBe(false);
        expect('readOnly' in r).toBe(false);
        expect('department' in r).toBe(false);
      }
    });

    it('listClients counts files across ALL departments (no PROCESSING filter)', async () => {
      const { svc, prisma } = listHarness();
      const out = (await svc.listClients(USER, DatabankDepartment.PROCESSING)) as Array<{ id: string; fileCount: number }>;
      // 2 Processing + 1 JR file on the client → 3 when department-blind.
      expect(out[0].fileCount).toBe(3);
      expect(prisma.databankFile.groupBy.mock.calls[0][0].where.department).toBeUndefined();
    });
  });

  describe('FLAG ON — department scoping + JR share-in', () => {
    beforeEach(() => {
      process.env[ENV] = 'on';
    });

    it('Processing getTree returns ONLY Processing rows (never JR)', async () => {
      const { svc } = treeHarness([{ id: 'sh', clientId: CLIENT, folderId: null, toDepartment: DatabankDepartment.JR, revokedAt: null }]);
      const out = await svc.getTree(CLIENT, USER, DatabankDepartment.PROCESSING);
      expect(ids(out.folders)).toEqual(['pf1', 'pf1a', 'pf2']);
      expect(ids(out.files)).toEqual(['pfile1', 'pfile1a', 'pfile2', 'pfileRoot']);
      // A share to JR must not leak JR's own rows into the Processing view.
      expect(ids(out.folders)).not.toContain('jf1');
    });

    it('JR getTree with NO share returns ONLY JR rows (zero Processing)', async () => {
      const { svc } = treeHarness([]);
      const out = await svc.getTree(CLIENT, USER, DatabankDepartment.JR);
      expect(ids(out.folders)).toEqual(['jf1']);
      expect(ids(out.files)).toEqual(['jfile1', 'jfileRoot']);
      for (const r of [...out.folders, ...out.files]) {
        expect((r as Row).department).toBe(DatabankDepartment.JR);
        expect((r as Row).shared).toBeFalsy();
      }
    });

    it("JR getTree with a WHOLE-client share ('ALL') returns JR + all Processing, Processing tagged shared/readOnly", async () => {
      const { svc } = treeHarness([{ id: 'sh', clientId: CLIENT, folderId: null, toDepartment: DatabankDepartment.JR, revokedAt: null }]);
      const out = await svc.getTree(CLIENT, USER, DatabankDepartment.JR);

      expect(ids(out.folders)).toEqual(['jf1', 'pf1', 'pf1a', 'pf2']);
      expect(ids(out.files)).toEqual(['jfile1', 'jfileRoot', 'pfile1', 'pfile1a', 'pfile2', 'pfileRoot']);

      const folders = byId(out.folders);
      const files = byId(out.files);
      // JR's own rows: department JR, not shared/readOnly.
      expect(folders.get('jf1')).toMatchObject({ department: DatabankDepartment.JR });
      expect(folders.get('jf1')!.shared).toBeFalsy();
      expect(files.get('jfile1')).toMatchObject({ department: DatabankDepartment.JR });
      // Shared-in Processing rows: tagged shared + readOnly + department PROCESSING.
      for (const id of ['pf1', 'pf1a', 'pf2']) {
        expect(folders.get(id)).toMatchObject({ shared: true, readOnly: true, department: DatabankDepartment.PROCESSING });
      }
      for (const id of ['pfile1', 'pfile1a', 'pfile2', 'pfileRoot']) {
        expect(files.get(id)).toMatchObject({ shared: true, readOnly: true, department: DatabankDepartment.PROCESSING });
      }
    });

    it('JR getTree with a FOLDER share returns JR + only that folder-subtree\'s Processing rows', async () => {
      // Share the pf1 subtree only (pf1 → pf1a). pf2 and the Processing client-root
      // file must NOT appear.
      const { svc } = treeHarness([{ id: 'sh', clientId: CLIENT, folderId: 'pf1', toDepartment: DatabankDepartment.JR, revokedAt: null }]);
      const out = await svc.getTree(CLIENT, USER, DatabankDepartment.JR);

      expect(ids(out.folders)).toEqual(['jf1', 'pf1', 'pf1a']);
      expect(ids(out.files)).toEqual(['jfile1', 'jfileRoot', 'pfile1', 'pfile1a']);
      // Out-of-subtree Processing rows stay hidden.
      expect(ids(out.folders)).not.toContain('pf2');
      expect(ids(out.files)).not.toContain('pfile2');
      expect(ids(out.files)).not.toContain('pfileRoot');

      const folders = byId(out.folders);
      expect(folders.get('pf1')).toMatchObject({ shared: true, readOnly: true, department: DatabankDepartment.PROCESSING });
      expect(folders.get('pf1a')).toMatchObject({ shared: true, readOnly: true, department: DatabankDepartment.PROCESSING });
    });

    it('listClients (Processing landing) file count EXCLUDES JR files', async () => {
      const { svc, prisma } = listHarness();
      const out = (await svc.listClients(USER, DatabankDepartment.PROCESSING)) as Array<{ id: string; fileCount: number }>;
      // 2 Processing files only; the 1 JR file is excluded.
      expect(out[0].fileCount).toBe(2);
      expect(prisma.databankFile.groupBy.mock.calls[0][0].where.department).toBe(DatabankDepartment.PROCESSING);
    });
  });
});

/** A client with 2 Processing + 1 JR file, for the landing-count tests. groupBy
 *  honours the `where.department` filter so the ON/OFF difference is observable. */
function listHarness() {
  const files = [
    { clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null },
    { clientId: CLIENT, department: DatabankDepartment.PROCESSING, deletedAt: null },
    { clientId: CLIENT, department: DatabankDepartment.JR, deletedAt: null },
  ];
  const prisma = {
    client: {
      findMany: jest.fn(async () => [{ id: CLIENT, referenceCode: 'TIS-1', firstName: 'A', lastName: 'B' }]),
    },
    databankFile: {
      groupBy: jest.fn(async (args: { where: any }) => {
        const where = args.where;
        const matched = files.filter(
          (f) =>
            f.deletedAt === null &&
            where.clientId.in.includes(f.clientId) &&
            (where.department === undefined || f.department === where.department),
        );
        return matched.length ? [{ clientId: CLIENT, _count: { _all: matched.length } }] : [];
      }),
    },
  };
  const svc = new DatabankService(prisma as never, {} as never);
  return { svc, prisma };
}
