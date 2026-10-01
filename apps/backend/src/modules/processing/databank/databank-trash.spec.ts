import { NotFoundException } from '@nestjs/common';
import { DatabankService } from './databank.service';
import { DatabankTrashSweeperService } from './databank-trash-sweeper.service';

/**
 * Databank P3 — trash (list / restore / permanent purge) + the retention
 * sweeper. Prisma and StorageService are mocks; the transaction client is a
 * SEPARATE object from the outer prisma, so any folder/file write that escaped a
 * transaction would hit a different mock. No DB. authorizeRow is stubbed so the
 * tests exercise the trash logic, not the (separately tested) access model.
 */

const USER = { id: 'u1', permissions: ['processing.document.upload'] } as never;
const D = (iso: string) => new Date(iso);

function svcHarness() {
  const order: string[] = [];
  const mk = (label: string) => ({
    findFirst: jest.fn(async () => (order.push(`${label}.findFirst`), null)),
    findFirstOrThrow: jest.fn(async (a: any) => (order.push(`${label}.findFirstOrThrow`), { id: a.where.id })),
    findMany: jest.fn(async () => (order.push(`${label}.findMany`), [])),
    create: jest.fn(async (a: any) => (order.push(`${label}.create`), { id: 'new', ...a.data })),
    update: jest.fn(async (a: any) => (order.push(`${label}.update`), { id: a.where.id, ...a.data })),
    updateMany: jest.fn(async () => (order.push(`${label}.updateMany`), { count: 1 })),
    deleteMany: jest.fn(async () => (order.push(`${label}.deleteMany`), { count: 1 })),
  });
  const tx: any = {
    databankFolder: mk('tx.folder'),
    databankFile: mk('tx.file'),
    $executeRaw: jest.fn(async () => (order.push('lock'), 1)),
    $queryRaw: jest.fn(async () => (order.push('tx.queryRaw'), [])),
  };
  const prisma: any = {
    databankFolder: mk('folder'),
    databankFile: mk('file'),
    $queryRaw: jest.fn(async () => (order.push('queryRaw'), [])),
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => (order.push('txn'), fn(tx))),
  };
  const storage = { delete: jest.fn(async (k: string) => (order.push(`storage.delete:${k}`), undefined)) };
  const svc = new DatabankService(prisma as never, storage as never);
  // Bypass the (separately tested) access model.
  (svc as any).authorizeRow = jest.fn().mockResolvedValue(undefined);
  (svc as any).assertClientReadAccess = jest.fn().mockResolvedValue(undefined);
  (svc as any).assertPersonalAccess = jest.fn();
  return { svc, prisma, tx, storage, order };
}

describe('DatabankService — trash listing', () => {
  it('listTrash returns only TOP-LEVEL trashed items (hides trashed descendants), newest first', async () => {
    const { svc, prisma } = svcHarness();
    // F1 (root) trashed; F2 trashed but nested under F1 → hidden.
    const folders = [
      { id: 'F1', name: 'Passport', parentFolderId: null, deletedAt: D('2026-09-02') },
      { id: 'F2', name: 'Scans', parentFolderId: 'F1', deletedAt: D('2026-09-02') },
    ];
    // X1 at root (top); X2 under trashed F2 (hidden); X3 under LIVE folder (top).
    const files = [
      { id: 'X1', fileName: 'a.pdf', folderId: null, deletedAt: D('2026-09-03'), fileSizeBytes: 10 },
      { id: 'X2', fileName: 'b.pdf', folderId: 'F2', deletedAt: D('2026-09-01'), fileSizeBytes: 20 },
      { id: 'X3', fileName: 'c.pdf', folderId: 'LIVE', deletedAt: D('2026-09-04'), fileSizeBytes: 30 },
    ];
    prisma.databankFolder.findMany
      .mockImplementationOnce(async () => folders) // trashed folders
      .mockImplementationOnce(async () => [{ id: 'LIVE', name: 'Live Folder' }]); // parent names
    prisma.databankFile.findMany.mockImplementationOnce(async () => files);

    const out = await svc.listTrash(USER, { personal: true });

    // Scope + deletedAt filter on the trashed-folders query.
    expect(prisma.databankFolder.findMany.mock.calls[0][0].where).toEqual({
      clientId: null,
      ownerUserId: 'u1',
      deletedAt: { not: null },
    });
    // Only F1, X1, X3 — F2 and X2 (nested under a trashed folder) are hidden.
    expect(out.map((i: any) => i.id)).toEqual(['X3', 'X1', 'F1']); // deletedAt desc
    expect(out.find((i: any) => i.id === 'F2')).toBeUndefined();
    expect(out.find((i: any) => i.id === 'X2')).toBeUndefined();
    expect(out.find((i: any) => i.id === 'X3')).toMatchObject({
      kind: 'file',
      name: 'c.pdf',
      sizeBytes: 30,
      originalParentName: 'Live Folder',
    });
    expect(out.find((i: any) => i.id === 'F1')).toMatchObject({
      kind: 'folder',
      name: 'Passport',
      originalParentName: null,
    });
    // Parent-name lookup only for the live folder a top-level item sat in.
    expect(prisma.databankFolder.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['LIVE'] } });
  });

  it('listTrash rejects both / neither scope', async () => {
    const { svc } = svcHarness();
    await expect(svc.listTrash(USER, { clientId: 'c1', personal: true })).rejects.toThrow('not both');
    await expect(svc.listTrash(USER, {})).rejects.toThrow('Provide either');
  });
});

describe('DatabankService — move/copy serialize vs a concurrent trash', () => {
  it('moveFile takes FOR SHARE on a LIVE destination and reparents the file THERE', async () => {
    const { svc, prisma, tx, order } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'F1', clientId: null, ownerUserId: 'u1', folderId: null });
    (svc as any).assertFolderInScope = jest.fn(async () => 'X');
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'X' }]); // destination live + now share-locked

    await svc.moveFile('F1', 'X', USER);

    // The reparent runs inside the txn, gated by the FOR SHARE probe on the folder.
    expect(order).toContain('txn');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // the FOR SHARE probe
    expect(tx.databankFile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'F1' }, data: { folderId: 'X' } }),
    );
  });

  it('moveFile relocates to the ROOT when the destination was trashed since the scope check (FOR SHARE empty)', async () => {
    const { svc, prisma, tx } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'F1', clientId: null, ownerUserId: 'u1', folderId: null });
    (svc as any).assertFolderInScope = jest.fn(async () => 'X');
    tx.$queryRaw.mockResolvedValueOnce([]); // destination trashed/gone under the lock

    await svc.moveFile('F1', 'X', USER);

    expect(tx.databankFile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { folderId: null } }), // never stranded inside the trashed folder
    );
  });

  it('copyFile takes FOR SHARE on a LIVE destination and creates the copy THERE', async () => {
    const { svc, prisma, tx, storage } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({
      id: 'S1', clientId: null, ownerUserId: 'u1', folderId: null, storageKey: 'src', fileName: 'a.pdf', mimeType: 'application/pdf', fileSizeBytes: 10, sha256: 'h',
    });
    (svc as any).assertFolderInScope = jest.fn(async () => 'X');
    (storage as any).copyObject = jest.fn(async () => ({ key: 'copykey', sizeBytes: 10 }));
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'X' }]); // destination live + share-locked

    await svc.copyFile('S1', { targetFolderId: 'X' } as never, USER);

    expect(tx.databankFile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ folderId: 'X', storageKey: 'copykey' }) }),
    );
  });

  it('copyFile relocates the new copy to the ROOT when the destination was trashed meanwhile', async () => {
    const { svc, prisma, tx, storage } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({
      id: 'S1', clientId: null, ownerUserId: 'u1', folderId: null, storageKey: 'src', fileName: 'a.pdf', mimeType: 'application/pdf', fileSizeBytes: 10, sha256: 'h',
    });
    (svc as any).assertFolderInScope = jest.fn(async () => 'X');
    (storage as any).copyObject = jest.fn(async () => ({ key: 'copykey', sizeBytes: 10 }));
    tx.$queryRaw.mockResolvedValueOnce([]); // destination trashed/gone under the lock

    await svc.copyFile('S1', { targetFolderId: 'X' } as never, USER);

    expect(tx.databankFile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ folderId: null, storageKey: 'copykey' }) }),
    );
  });
});

describe('DatabankService — restore', () => {
  it('restoreFolder with a TRASHED parent restores to the ROOT and renames on a live name-clash', async () => {
    const { svc, prisma, tx, order } = svcHarness();
    const trashed = {
      id: 'F2',
      clientId: null,
      ownerUserId: 'u1',
      parentFolderId: 'F1',
      name: 'Scans',
      deletedAt: D('2026-09-02'),
    };
    prisma.databankFolder.findFirst.mockResolvedValueOnce(trashed); // loadTrashedFolder
    tx.databankFolder.findFirst
      .mockResolvedValueOnce(trashed) // reload under the lock
      .mockResolvedValueOnce(null) // original parent F1 is trashed → not live → root
      .mockResolvedValueOnce({ id: 'other' }) // "Scans" taken at root
      .mockResolvedValueOnce(null); // "Scans (2)" free
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'F2' }, { id: 'F3' }]); // trashed subtree

    const out = await svc.restoreFolder('F2', USER);

    // The lock is the FIRST thing inside the transaction, before any write.
    expect(order.slice(0, 2)).toEqual(['txn', 'lock']);
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('tx.folder.updateMany'));
    // Un-stamped the WHOLE trashed subtree, folders then files.
    expect(tx.databankFolder.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['F2', 'F3'] }, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    expect(tx.databankFile.updateMany).toHaveBeenCalledWith({
      where: { folderId: { in: ['F2', 'F3'] }, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    // Reparented to root + disambiguated name.
    expect(tx.databankFolder.update.mock.calls[0][0].data).toEqual({ parentFolderId: null, name: 'Scans (2)' });
    expect(out.name).toBe('Scans (2)');
  });

  it('restoreFolder keeps the original parent when it is still live', async () => {
    const { svc, prisma, tx } = svcHarness();
    const trashed = { id: 'F2', clientId: 'c1', ownerUserId: null, parentFolderId: 'F1', name: 'Scans' };
    prisma.databankFolder.findFirst.mockResolvedValueOnce(trashed);
    tx.databankFolder.findFirst
      .mockResolvedValueOnce(trashed) // reload
      .mockResolvedValueOnce({ id: 'F1' }) // parent F1 is live
      .mockResolvedValueOnce(null); // name free in F1
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'F2' }]);
    await svc.restoreFolder('F2', USER);
    expect(tx.databankFolder.update.mock.calls[0][0].data).toEqual({ parentFolderId: 'F1', name: 'Scans' });
  });

  it('restoreFile takes the scope lock, restores to the ROOT when the folder is trashed (compare-and-set)', async () => {
    const { svc, prisma, tx, order } = svcHarness();
    const file = { id: 'X1', clientId: null, ownerUserId: 'u1', folderId: 'F2', fileName: 'a.pdf', storageKey: 'k' };
    prisma.databankFile.findFirst.mockResolvedValueOnce(file); // loadTrashedFile
    tx.databankFolder.findFirst.mockResolvedValueOnce(null); // F2 trashed under the lock → root

    await svc.restoreFile('X1', USER);

    // Runs under the per-scope folder lock, inside the transaction.
    expect(order.indexOf('lock')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('tx.file.updateMany'));
    // Compare-and-set: only a still-trashed row is restored; folder cleared (root).
    expect(tx.databankFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'X1', deletedAt: { not: null } },
      data: { deletedAt: null, folderId: null },
    });
  });

  it('restoreFile keeps the live folder when it still exists (re-checked under the lock)', async () => {
    const { svc, prisma, tx } = svcHarness();
    const file = { id: 'X1', clientId: null, ownerUserId: 'u1', folderId: 'F2', fileName: 'a.pdf', storageKey: 'k' };
    prisma.databankFile.findFirst.mockResolvedValueOnce(file);
    tx.databankFolder.findFirst.mockResolvedValueOnce({ id: 'F2' }); // F2 live
    await svc.restoreFile('X1', USER);
    expect(tx.databankFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'X1', deletedAt: { not: null } },
      data: { deletedAt: null, folderId: 'F2' },
    });
  });

  it('restoreFile 404s (not a 500) when the file was purged since the load', async () => {
    const { svc, prisma, tx } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'X1', clientId: null, ownerUserId: 'u1', folderId: null, storageKey: 'k' });
    tx.databankFile.updateMany.mockResolvedValueOnce({ count: 0 }); // raced a purge
    await expect(svc.restoreFile('X1', USER)).rejects.toThrow(NotFoundException);
  });
});

describe('DatabankService — permanent purge', () => {
  it('purgeFile REJECTS a non-trashed (live) file and never deletes or frees storage', async () => {
    const { svc, prisma, storage } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce(null); // a live file is not found by the trashed loader
    await expect(svc.purgeFile('X1', USER)).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('purgeFolder REJECTS a non-trashed (live) folder and never deletes or frees storage', async () => {
    const { svc, prisma, storage } = svcHarness();
    prisma.databankFolder.findFirst.mockResolvedValueOnce(null);
    await expect(svc.purgeFolder('F1', USER)).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('purgeFile hard-deletes the row (compare-and-set on deletedAt) THEN frees its storage, in that order', async () => {
    const { svc, prisma, tx, storage, order } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'X1', clientId: null, ownerUserId: 'u1', storageKey: 'kf' });
    tx.databankFile.deleteMany.mockResolvedValueOnce({ count: 1 });

    const out = await svc.purgeFile('X1', USER);

    expect(tx.databankFile.deleteMany).toHaveBeenCalledWith({ where: { id: 'X1', deletedAt: { not: null } } });
    // DB delete committed BEFORE storage is freed.
    expect(order.indexOf('tx.file.deleteMany')).toBeLessThan(order.indexOf('storage.delete:kf'));
    expect(storage.delete).toHaveBeenCalledWith('kf');
    expect(out).toEqual({ id: 'X1', purged: true });
  });

  it('purgeFolder deletes only TRASHED rows THEN frees each deleted file key, in that order', async () => {
    const { svc, prisma, tx, storage, order } = svcHarness();
    prisma.databankFolder.findFirst.mockResolvedValueOnce({ id: 'F1', clientId: null, ownerUserId: 'u1' });
    tx.databankFolder.findFirst.mockResolvedValueOnce({ id: 'F1', clientId: null, ownerUserId: 'u1' }); // reload
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'F1' }, { id: 'F2' }]); // subtree
    tx.databankFile.findMany.mockResolvedValueOnce([
      { id: 'A', storageKey: 'k1' },
      { id: 'B', storageKey: 'k2' },
    ]); // TRASHED files

    const out = await svc.purgeFolder('F1', USER);

    // Files deleted by ID (the trashed ones); folders guarded to trashed only.
    expect(tx.databankFile.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['A', 'B'] } } });
    expect(tx.databankFolder.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['F1', 'F2'] }, deletedAt: { not: null } },
    });
    // The trashed-file scan is filtered to deletedAt NOT null.
    expect(tx.databankFile.findMany).toHaveBeenCalledWith({
      where: { folderId: { in: ['F1', 'F2'] }, deletedAt: { not: null } },
      select: { id: true, storageKey: true },
    });
    // Rows gone BEFORE storage is freed.
    expect(order.indexOf('tx.file.deleteMany')).toBeLessThan(order.indexOf('storage.delete:k1'));
    expect(order.indexOf('tx.folder.deleteMany')).toBeLessThan(order.indexOf('storage.delete:k1'));
    expect(storage.delete.mock.calls).toEqual([['k1'], ['k2']]);
    expect(out).toEqual({ purgedFolders: 2, purgedFiles: 2 });
  });

  it('purgeFolder moves a stranded LIVE file to the root (never hard-deletes or frees it)', async () => {
    const { svc, prisma, tx } = svcHarness();
    prisma.databankFolder.findFirst.mockResolvedValueOnce({ id: 'F1', clientId: null, ownerUserId: 'u1' });
    tx.databankFolder.findFirst.mockResolvedValueOnce({ id: 'F1', clientId: null, ownerUserId: 'u1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'F1' }]);
    tx.databankFile.findMany.mockResolvedValueOnce([]); // no trashed files under F1

    await svc.purgeFolder('F1', USER);

    // A LIVE file under the trashed folder is relocated to root before the cascade.
    expect(tx.databankFile.updateMany).toHaveBeenCalledWith({
      where: { folderId: { in: ['F1'] }, deletedAt: null },
      data: { folderId: null },
    });
  });

  it('a storage.delete failure does NOT throw out of a purge (the committed DB delete stands)', async () => {
    const { svc, prisma, tx, storage } = svcHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'X1', clientId: null, ownerUserId: 'u1', storageKey: 'kf' });
    tx.databankFile.deleteMany.mockResolvedValueOnce({ count: 1 });
    storage.delete.mockRejectedValueOnce(new Error('storage down'));
    await expect(svc.purgeFile('X1', USER)).resolves.toEqual({ id: 'X1', purged: true });
  });
});

// ---------------------------------------------------------------------------
// Retention sweeper
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const withEnv = async (key: string, value: string | undefined, fn: () => Promise<void> | void) => {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
};

function sweeperHarness() {
  const prisma: any = {
    databankFile: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    databankFolder: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // The folder pass resolves each aged root's FULL cascade reach (recursive CTE)
    // so it can free the bytes of descendant files the FK cascade removes.
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const sweeper = new DatabankTrashSweeperService(prisma as never, storage as never);
  return { sweeper, prisma, storage };
}

describe('DatabankTrashSweeperService', () => {
  it('purges NOTHING when DATABANK_TRASH_RETENTION_DAYS is unset (the safe default)', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', undefined, async () => {
      const h = sweeperHarness();
      await h.sweeper.sweep(NOW);
      expect(h.prisma.databankFile.findMany).not.toHaveBeenCalled();
      expect(h.prisma.databankFolder.findMany).not.toHaveBeenCalled();
      expect(h.storage.delete).not.toHaveBeenCalled();
    });
  });

  it('purges NOTHING for a zero / non-numeric retention value', async () => {
    for (const bad of ['0', '-5', 'abc', '']) {
      // eslint-disable-next-line no-await-in-loop
      await withEnv('DATABANK_TRASH_RETENTION_DAYS', bad, async () => {
        const h = sweeperHarness();
        await h.sweeper.sweep(NOW);
        expect(h.prisma.databankFile.findMany).not.toHaveBeenCalled();
      });
    }
  });

  it('when set, purges only items trashed before the window — freeing storage for each', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', '30', async () => {
      const h = sweeperHarness();
      h.prisma.databankFile.findMany
        .mockResolvedValueOnce([{ id: 'a', storageKey: 'ka' }]) // candidates (< BATCH → one pass)
        .mockResolvedValueOnce([]); // survivors: none still alive
      await h.sweeper.sweep(NOW);

      const cutoff = new Date(NOW.getTime() - 30 * DAY);
      const notUnderTrashed = { OR: [{ folderId: null }, { folder: { deletedAt: null } }] };
      expect(h.prisma.databankFile.findMany.mock.calls[0][0].where).toEqual({
        deletedAt: { not: null, lt: cutoff },
        ...notUnderTrashed,
      });
      expect(h.prisma.databankFile.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['a'] }, deletedAt: { not: null, lt: cutoff }, ...notUnderTrashed },
      });
      expect(h.storage.delete).toHaveBeenCalledWith('ka');
      // Folder phase also scoped to the same cutoff.
      expect(h.prisma.databankFolder.findMany.mock.calls[0][0].where).toEqual({
        deletedAt: { not: null, lt: cutoff },
      });
    });
  });

  it('frees a descendant file under the FULL cascade reach of an aged folder (not just the batch roots)', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', '30', async () => {
      const h = sweeperHarness();
      // purgeAgedFiles finds no loose aged files → the folder pass runs.
      h.prisma.databankFile.findMany
        .mockResolvedValueOnce([]) // purgeAgedFiles: no aged files
        .mockResolvedValueOnce([{ id: 'x', storageKey: 'kx' }]) // reach capture: a file under descendant B
        .mockResolvedValueOnce([]); // survivors: x is gone (cascade removed it)
      h.prisma.databankFolder.findMany
        .mockResolvedValueOnce([{ id: 'A' }]) // one aged root
        .mockResolvedValueOnce([]); // drained
      // A's cascade reach is A + its descendant B (B is NOT in the flat batch).
      h.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'A' }, { id: 'B' }]);
      h.prisma.databankFolder.deleteMany.mockResolvedValueOnce({ count: 1 });

      await h.sweeper.sweep(NOW);

      // The reach capture covers the descendant folder B, not just root A.
      expect(h.prisma.databankFile.findMany.mock.calls[1][0].where).toEqual({
        folderId: { in: ['A', 'B'] },
        deletedAt: { not: null },
      });
      // Only the aged ROOTS are deleted (compare-and-set); the cascade clears B.
      const cutoff = new Date(NOW.getTime() - 30 * DAY);
      expect(h.prisma.databankFolder.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['A'] }, deletedAt: { not: null, lt: cutoff } },
      });
      // The descendant file's bytes are freed — the #3 leak is closed.
      expect(h.storage.delete).toHaveBeenCalledWith('kx');
    });
  });

  it('the folder pass does NOT relocate (never yanks a just-restored folder’s live files to the root)', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', '30', async () => {
      const h = sweeperHarness();
      h.prisma.databankFile.findMany.mockResolvedValue([]); // nothing aged anywhere
      h.prisma.databankFolder.findMany
        .mockResolvedValueOnce([{ id: 'A' }])
        .mockResolvedValueOnce([]);
      h.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'A' }]);
      await h.sweeper.sweep(NOW);
      // The removed relocate was a databankFile.updateMany({ folderId: null }).
      expect((h.prisma.databankFile as any).updateMany).toBeUndefined();
    });
  });

  it('does NOT free storage for a file restored between the scan and the delete', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', '30', async () => {
      const h = sweeperHarness();
      h.prisma.databankFile.findMany
        .mockResolvedValueOnce([{ id: 'a', storageKey: 'ka' }]) // candidate
        .mockResolvedValueOnce([{ id: 'a' }]); // it survived → restored, keep its bytes
      await h.sweeper.sweep(NOW);
      expect(h.storage.delete).not.toHaveBeenCalled();
    });
  });

  it('the kill-switch stops the timer from ever starting', async () => {
    await withEnv('DATABANK_TRASH_SWEEPER_ENABLED', 'false', () => {
      const h = sweeperHarness();
      const spy = jest.spyOn(global, 'setInterval');
      try {
        h.sweeper.onModuleInit();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
        h.sweeper.onModuleDestroy();
      }
    });
  });

  it('starts an (unref’d) hourly timer when enabled', async () => {
    await withEnv('DATABANK_TRASH_SWEEPER_ENABLED', undefined, () => {
      const h = sweeperHarness();
      const spy = jest.spyOn(global, 'setInterval');
      try {
        h.sweeper.onModuleInit();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1]).toBe(DatabankTrashSweeperService.INTERVAL_MS);
      } finally {
        spy.mockRestore();
        h.sweeper.onModuleDestroy();
      }
    });
  });
});
