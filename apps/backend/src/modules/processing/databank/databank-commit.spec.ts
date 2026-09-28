import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabankService } from './databank.service';

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
    $transaction: jest.fn(),
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
  it('records the file with one plain insert (no transaction, no extra round trips)', async () => {
    const { svc, prisma, log, rows, shape } = harness();
    const out = await svc.commitDirectUpload(DTO as never, USER);
    expect(log).toEqual(['findFirst', 'create']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(Object.keys(out).sort()).toEqual(shape);
    expect(out).toMatchObject({ id: rows[0].id, clientId: 'c1', fileName: 'passport.pdf' });
    expect(out).not.toHaveProperty('storageKey'); // (never sent to the browser)
  });

  it('two OVERLAPPING commits of one key (a lost reply, retried while the first still runs) make ONE row — both get it', async () => {
    const { svc, rows, log, shape } = harness({ headDelayTicks: 5 }); // both pass the first look before either records
    const [a, b] = await Promise.all([svc.commitDirectUpload(DTO as never, USER), svc.commitDirectUpload(DTO as never, USER)]);
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
      await expect(svc.commitDirectUpload(DTO as never, USER)).rejects.toBeInstanceOf(BadRequestException);
      expect(rows).toHaveLength(1);
    }
  });

  it('any other insert error still fails the commit as before', async () => {
    const { svc, prisma } = harness();
    prisma.databankFile.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(svc.commitDirectUpload(DTO as never, USER)).rejects.toThrow('connection lost');
  });

  it('a plain retried commit (the row exists already) is answered from the first look, without a HEAD', async () => {
    const { svc, storage, rows, prisma, shape } = harness();
    rows.push(fullRow({ id: 'file-1' }));
    const out = await svc.commitDirectUpload(DTO as never, USER);
    expect(out.id).toBe('file-1');
    expect(Object.keys(out).sort()).toEqual(shape);
    expect(storage.headObjectMeta).not.toHaveBeenCalled();
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
