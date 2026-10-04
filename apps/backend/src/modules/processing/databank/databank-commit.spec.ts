import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { DatabankDepartment, Prisma } from '@prisma/client';
import { DatabankService } from './databank.service';

/** This spec drives the service as the PROCESSING portal would. */
const DEPT = DatabankDepartment.PROCESSING;

/**
 * The standard (≤ 2 GB) upload's commit: one row per storage key, even when two
 * commits of the same key overlap (a retry whose first reply was lost while the
 * server was still recording it). Prisma is an in-memory fake whose create
 * enforces the UNIQUE storageKey like Postgres (P2002). No DB.
 */

const USER = { id: 'u1', permissions: ['processing.document.upload'] } as never;
const SCOPE = { clientId: 'c1', ownerUserId: null, storageFolder: 'databank/clients/c1' };
const KEY = 'databank/clients/c1/0f8fad5b-d9cb-469f-a165-70867728950e.pdf';
const DTO = { clientId: 'c1', folderId: null, fileName: 'passport.pdf', mimeType: 'application/pdf', fileSizeBytes: 10, storageKey: KEY };

type Row = { id: string; clientId: string | null; ownerUserId: string | null; deletedAt: Date | null; storageKey: string } & Record<string, unknown>;

/** A stored row with every column the real table has (the fake returns only what `select` asks for). */
const fullRow = (over: Partial<Row>): Row => ({
  id: 'file-1',
  clientId: 'c1',
  ownerUserId: null,
  folderId: null,
  fileName: 'passport.pdf',
  storageKey: KEY,
  mimeType: 'application/pdf',
  fileSizeBytes: BigInt(10),
  source: 'UPLOAD',
  uploadedByUserId: 'u1',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  ...over,
});

/** Like Prisma: with a `select`, only the selected columns come back. */
const pick = (row: Row | null, select?: Record<string, boolean>) =>
  !row || !select ? row : Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));

const tick = () => new Promise<void>((r) => setImmediate(r));
const unique = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`storageKey`)', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target: ['storageKey'] },
  });

function harness(opts: { headDelayTicks?: number } = {}) {
  const rows: Row[] = [];
  const log: string[] = [];
  const find = (where: { storageKey?: string; id?: string }) =>
    rows.find((r) => (where.storageKey === undefined || r.storageKey === where.storageKey) && (where.id === undefined || r.id === where.id)) ?? null;
  const prisma = {
    databankUpload: { findUnique: jest.fn(async () => null) },
    // isVersionOwnedKey (create paths reject a key a version row owns). Default
    // null = not version-owned → normal flow.
    databankFileVersion: { findUnique: jest.fn(async (): Promise<{ id: string } | null> => null) },
    databankFile: {
      findFirst: jest.fn(async (a: { where: { storageKey: string }; select?: Record<string, boolean> }) => {
        log.push('findFirst');
        await tick();
        return pick(find(a.where), a.select) as any;
      }),
      findUniqueOrThrow: jest.fn(async (a: { where: { id: string }; select?: Record<string, boolean> }) => {
        log.push('findUniqueOrThrow');
        return pick(find(a.where)!, a.select) as any;
      }),
      create: jest.fn(async (a: { data: { storageKey: string } & Partial<Row>; select?: Record<string, boolean> }) => {
        log.push('create');
        await tick();
        if (find({ storageKey: a.data.storageKey })) throw unique(); // the UNIQUE index
        const row = fullRow({ ...a.data, id: `file-${rows.length + 1}` });
        rows.push(row);
        return pick(row, a.select) as any;
      }),
    },
    // The commit now records the row inside a transaction so it can take FOR
    // SHARE on its live destination folder (lockLiveDestinationFolder) and
    // serialize against a concurrent subtree delete/purge. The fake runs the
    // callback against this same prisma (shared rows/log), and $queryRaw backs
    // the FOR SHARE probe — not reached for a root (null) folder.
    $queryRaw: jest.fn(async (): Promise<unknown[]> => []),
    $transaction: jest.fn(async (fn: (t: unknown) => unknown): Promise<unknown> => fn(prisma)),
  };
  const storage = {
    headObjectMeta: jest.fn(async () => {
      for (let i = 0; i < (opts.headDelayTicks ?? 0); i++) await tick();
      return { exists: true, sizeBytes: 10 };
    }),
    delete: jest.fn(async () => undefined),
  };
  const svc = new DatabankService(prisma as never, storage as never);
  jest.spyOn(svc as any, 'resolveWriteScope').mockResolvedValue(SCOPE);
  (svc as any).assertFolderInScope = jest.fn(async () => null);
  const shape = Object.keys((svc as any).fileSelect).sort(); // what the endpoint returns
  return { svc, prisma, storage, rows, log, shape };
}

describe('DatabankService.commitDirectUpload — one row per key', () => {
  it('records the file with one insert inside a transaction (FOR SHARE on a root folder is a no-op)', async () => {
    const { svc, prisma, log, rows, shape } = harness();
    const out = await svc.commitDirectUpload(DTO as never, USER, DEPT);
    // One existing-row look, then the insert inside the txn. A root (null) folder
    // short-circuits lockLiveDestinationFolder, so no FOR SHARE probe is issued.
    expect(log).toEqual(['findFirst', 'create']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(Object.keys(out).sort()).toEqual(shape);
    expect(out).toMatchObject({ id: rows[0].id, clientId: 'c1', fileName: 'passport.pdf' });
    expect(out).not.toHaveProperty('storageKey'); // (never sent to the browser)
  });

  it('two OVERLAPPING commits of one key (a lost reply, retried while the first still runs) make ONE row — both get it', async () => {
    const { svc, rows, log, shape } = harness({ headDelayTicks: 5 }); // both pass the first look before either records
    const [a, b] = await Promise.all([svc.commitDirectUpload(DTO as never, USER, DEPT), svc.commitDirectUpload(DTO as never, USER, DEPT)]);
    expect(log.filter((l) => l === 'create')).toHaveLength(2); // (precondition: both really tried to insert)
    expect(rows).toHaveLength(1);
    expect(a.id).toBe(rows[0].id);
    // the one that lost the race gets the SAME full answer — not a stub of the re-read
    expect(b).toEqual(a);
    expect(Object.keys(b).sort()).toEqual(shape);
  });

  it('the row that won belongs to ANOTHER databank, or is deleted: refused, nothing more is created', async () => {
    for (const other of [
      { clientId: 'c2', ownerUserId: null, deletedAt: null },
      { clientId: null, ownerUserId: 'u9', deletedAt: null },
      { clientId: 'c1', ownerUserId: null, deletedAt: new Date() },
    ]) {
      const { svc, prisma, rows } = harness();
      // the first look finds nothing; the row lands before our insert
      prisma.databankFile.findFirst.mockImplementationOnce(async () => {
        rows.push(fullRow({ id: 'x', ...other }));
        return null;
      });
      await expect(svc.commitDirectUpload(DTO as never, USER, DEPT)).rejects.toBeInstanceOf(BadRequestException);
      expect(rows).toHaveLength(1);
    }
  });

  it('any other insert error still fails the commit as before', async () => {
    const { svc, prisma } = harness();
    prisma.databankFile.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(svc.commitDirectUpload(DTO as never, USER, DEPT)).rejects.toThrow('connection lost');
  });

  it('a plain retried commit (the row exists already) is answered from the first look, without a HEAD', async () => {
    const { svc, storage, rows, prisma, shape } = harness();
    rows.push(fullRow({ id: 'file-1' }));
    const out = await svc.commitDirectUpload(DTO as never, USER, DEPT);
    expect(out.id).toBe('file-1');
    expect(Object.keys(out).sort()).toEqual(shape);
    expect(storage.headObjectMeta).not.toHaveBeenCalled();
    expect(prisma.databankFile.create).not.toHaveBeenCalled();
  });

  it('a commit into a LIVE folder takes FOR SHARE on it and records the row THERE', async () => {
    const { svc, prisma, rows } = harness();
    (svc as any).assertFolderInScope = jest.fn(async () => 'F1');
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'F1' }]); // folder live + now share-locked
    const out = await svc.commitDirectUpload({ ...DTO, folderId: 'F1' } as never, USER, DEPT);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // the FOR SHARE probe
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(rows[0].folderId).toBe('F1');
    expect(out.folderId).toBe('F1');
  });

  it('a commit RACING a delete of its folder (FOR SHARE finds it gone) lands at the ROOT, never stranded', async () => {
    const { svc, prisma, rows } = harness();
    (svc as any).assertFolderInScope = jest.fn(async () => 'F1'); // live at the pre-txn check
    prisma.$queryRaw.mockResolvedValueOnce([]); // …but trashed/removed by the time we lock it
    const out = await svc.commitDirectUpload({ ...DTO, folderId: 'F1' } as never, USER, DEPT);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rows[0].folderId).toBeNull(); // relocated to root — not left inside the trashed folder
    expect(out.folderId).toBeNull();
  });

  it('REFUSES a key already owned by a DatabankFileVersion row (never adopts a version object as a new file)', async () => {
    const { svc, prisma, rows } = harness();
    // A non-current version owns this key (its file's mirror was repointed away by
    // restoreVersion). Committing it as a NEW file would double-own the object →
    // purging that file would destroy the version's bytes. Must be refused.
    prisma.databankFileVersion.findUnique.mockResolvedValue({ id: 'vX' });
    await expect(svc.commitDirectUpload(DTO as never, USER, DEPT)).rejects.toBeInstanceOf(BadRequestException);
    expect(rows).toHaveLength(0);
    expect(prisma.databankFile.create).not.toHaveBeenCalled();
  });

  it('the database enforces it: storageKey is UNIQUE in the schema and a migration makes it so', () => {
    const root = join(__dirname, '../../../../prisma');
    const schema = readFileSync(join(root, 'schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model DatabankFile {'), schema.indexOf('@@map("databank_files")'));
    expect(model).toMatch(/\n\s*storageKey\s+String\s+@unique\b/);
    const sql = readFileSync(join(root, 'migrations/20260929090000_databank_files_storage_key_unique/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX "databank_files_storageKey_key" ON "processing"."databank_files"("storageKey")');
  });
});
