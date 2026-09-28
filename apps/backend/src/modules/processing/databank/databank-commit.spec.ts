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

type Row = { id: string; clientId: string | null; ownerUserId: string | null; deletedAt: Date | null; storageKey: string };

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
      findFirst: jest.fn(async (a: { where: { storageKey: string } }) => {
        log.push('findFirst');
        await tick();
        return find(a.where);
      }),
      findUniqueOrThrow: jest.fn(async (a: { where: { id: string } }) => {
        log.push('findUniqueOrThrow');
        return find(a.where)!;
      }),
      create: jest.fn(async (a: { data: Omit<Row, 'id' | 'deletedAt'> }) => {
        log.push('create');
        await tick();
        if (find({ storageKey: a.data.storageKey })) throw unique(); // the UNIQUE index
        const row = { id: `file-${rows.length + 1}`, deletedAt: null, ...a.data } as Row;
        rows.push(row);
        return row;
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
  return { svc, prisma, storage, rows, log };
}

describe('DatabankService.commitDirectUpload — one row per key', () => {
  it('records the file with one plain insert (no transaction, no extra round trips)', async () => {
    const { svc, prisma, log, rows } = harness();
    const out = await svc.commitDirectUpload(DTO as never, USER);
    expect(log).toEqual(['findFirst', 'create']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(out).toMatchObject({ storageKey: KEY, clientId: 'c1' });
  });

  it('two OVERLAPPING commits of one key (a lost reply, retried while the first still runs) make ONE row — both get it', async () => {
    const { svc, rows, log } = harness({ headDelayTicks: 5 }); // both pass the first look before either records
    const [a, b] = await Promise.all([svc.commitDirectUpload(DTO as never, USER), svc.commitDirectUpload(DTO as never, USER)]);
    expect(log.filter((l) => l === 'create')).toHaveLength(2); // (precondition: both really tried to insert)
    expect(rows).toHaveLength(1);
    expect(a.id).toBe(rows[0].id);
    expect(b.id).toBe(rows[0].id);
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
        rows.push({ id: 'x', storageKey: KEY, ...other });
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
    const { svc, storage, rows, prisma } = harness();
    rows.push({ id: 'file-1', clientId: 'c1', ownerUserId: null, deletedAt: null, storageKey: KEY });
    const out = await svc.commitDirectUpload(DTO as never, USER);
    expect(out.id).toBe('file-1');
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
