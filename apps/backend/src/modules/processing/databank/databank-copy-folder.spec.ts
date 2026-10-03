import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabankFileSource } from '@prisma/client';
import { DatabankService } from './databank.service';

/**
 * Databank — recursive folder copy (copyFolder). Prisma + StorageService are
 * mocks; the transaction client `tx` is a SEPARATE object from the outer prisma,
 * so any write that escaped a transaction would hit a different mock. No DB.
 *
 * The pure access/structure helpers (collectSubtree, assertFolderInScope,
 * uniqueFolderName, the locks, reloadFolder, loadFolderForRead, the auth gates)
 * are stubbed to happy-path values and overridden per test — they are exercised
 * by their own specs. assertNoCycle is LEFT REAL because the cycle tests are
 * what exercise it (and the copy-worded message it must now emit at BOTH throw
 * sites).
 */

const USER = { id: 'u1', permissions: ['processing.document.upload'] } as never;
const LIVE = { id: 'f1', clientId: 'c1', ownerUserId: null, name: 'Passport', parentFolderId: null };

function harness() {
  const order: string[] = [];
  const mkFolder = () => ({
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    createMany: jest.fn(async (a: any) => (order.push('folder.createMany'), { count: a.data.length })),
    findUniqueOrThrow: jest.fn(async (a: any) => ({
      id: a.where.id, name: 'ROOT', parentFolderId: null, createdAt: new Date(0), updatedAt: new Date(0),
    })),
    count: jest.fn(async () => 0),
  });
  const mkFile = () => ({
    findMany: jest.fn(async () => []),
    create: jest.fn(async (a: any) => (order.push('file.create'), { id: 'newfile', ...a.data })),
    count: jest.fn(async () => 0),
  });
  const tx: any = {
    databankFolder: mkFolder(),
    databankFile: mkFile(),
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => []), // only assertNoCycle (real) reaches this
  };
  const prisma: any = {
    databankFolder: mkFolder(),
    databankFile: mkFile(),
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => (order.push('txn'), fn(tx))),
  };
  const storage = {
    copyObject: jest.fn(async (key: string) => (order.push('copyObject'), { key: 'copy:' + key, bucket: 'b', sizeBytes: 1, mimeType: 'application/pdf' })),
    delete: jest.fn(),
  };
  const svc = new DatabankService(prisma as never, storage as never);
  (svc as any).loadFolderForRead = jest.fn(async () => ({ ...LIVE }));
  (svc as any).assertClientWriteAccess = jest.fn().mockResolvedValue(undefined);
  (svc as any).assertPersonalAccess = jest.fn();
  (svc as any).collectSubtree = jest.fn(async () => ['f1']);
  (svc as any).assertFolderInScope = jest.fn(async (id: string | null | undefined) => id ?? 'dest');
  (svc as any).lockFolderScope = jest.fn(async () => (order.push('lock'), undefined));
  (svc as any).reloadFolder = jest.fn(async () => ({ ...LIVE }));
  (svc as any).uniqueFolderName = jest.fn(async (_s: any, _p: any, desired: string) => desired);
  (svc as any).lockLiveDestinationFolder = jest.fn(async (_t: any, fid: string | null) => fid);
  return { svc, prisma, tx, storage, order };
}

describe('DatabankService — copyFolder', () => {
  it('1. refuses a copy into one of its own descendants before any folder is created', async () => {
    const { svc, tx } = harness();
    (svc as any).assertFolderInScope = jest.fn(async () => 'kid');
    tx.$queryRaw.mockResolvedValue([{ id: 'f1' }]); // assertNoCycle: source IS an ancestor of kid
    await expect(svc.copyFolder('f1', { targetFolderId: 'kid' }, USER)).rejects.toThrow(/copied into (itself|its own)/i);
    expect(tx.databankFolder.createMany).not.toHaveBeenCalled();
  });

  it('2. pasting a folder into itself is refused with the COPY-worded message (both throw sites parametrized)', async () => {
    const { svc, tx } = harness();
    (svc as any).assertFolderInScope = jest.fn(async () => 'f1'); // target === source → self branch
    await expect(svc.copyFolder('f1', { targetFolderId: 'f1' }, USER)).rejects.toThrow(
      "A folder can't be copied into itself or one of its own subfolders",
    );
    expect(tx.databankFolder.createMany).not.toHaveBeenCalled();
  });

  it('3. destination write gate: a read-only source is not written into an unwritable scope', async () => {
    const { svc, prisma, storage } = harness();
    (svc as any).loadFolderForRead = jest.fn(async () => ({ ...LIVE, clientId: 'cRO' }));
    (svc as any).assertClientWriteAccess = jest.fn().mockRejectedValue(new ForbiddenException());
    await expect(svc.copyFolder('SRC', {}, USER)).rejects.toThrow(ForbiddenException);
    expect((svc as any).assertClientWriteAccess).toHaveBeenCalledWith('cRO', USER);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.copyObject).not.toHaveBeenCalled();
  });

  it('4. gates on the DESTINATION client (dto.targetClientId), not the readable source client', async () => {
    const { svc } = harness();
    (svc as any).loadFolderForRead = jest.fn(async () => ({ ...LIVE, clientId: 'A' }));
    (svc as any).assertClientWriteAccess = jest.fn().mockRejectedValue(new ForbiddenException());
    await expect(svc.copyFolder('SRC', { targetClientId: 'B' }, USER)).rejects.toThrow(ForbiddenException);
    expect((svc as any).assertClientWriteAccess).toHaveBeenCalledWith('B', USER);
  });

  it('5. suffixes the copied root "(2)" on a live-sibling clash, counting the source (excludeId undefined)', async () => {
    const { svc, tx } = harness();
    (svc as any).uniqueFolderName = jest.fn(async () => 'Passport (2)');
    tx.databankFolder.findMany.mockResolvedValue([{ id: 'f1', name: 'Passport', parentFolderId: null }]);
    await svc.copyFolder('f1', { targetFolderId: 'dest' }, USER);
    const created = tx.databankFolder.createMany.mock.calls[0][0].data;
    expect(created[0].name).toBe('Passport (2)');
    // excludeId (4th arg) must be undefined — the live source is a real sibling.
    expect((svc as any).uniqueFolderName.mock.calls[0][3]).toBeUndefined();
  });

  it('6. copies a file verbatim even when its name already exists in the destination (no dedup)', async () => {
    const { svc, tx, prisma } = harness();
    tx.databankFolder.findMany.mockResolvedValue([{ id: 'f1', name: 'Passport', parentFolderId: null }]);
    prisma.databankFile.findMany.mockResolvedValue([
      { id: 'F1', folderId: 'f1', fileName: 'report.pdf', storageKey: 'k', mimeType: 'application/pdf', fileSizeBytes: BigInt(10), sha256: 'h' },
    ]);
    await svc.copyFolder('f1', { targetFolderId: 'dest' }, USER);
    expect(tx.databankFile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fileName: 'report.pdf', source: DatabankFileSource.COPIED }) }),
    );
  });

  it('7. relocates a copied file to ROOT when its skeleton folder was trashed mid-copy (never stranded)', async () => {
    const { svc, tx, prisma } = harness();
    tx.databankFolder.findMany.mockResolvedValue([{ id: 'f1', name: 'Docs', parentFolderId: null }]);
    prisma.databankFile.findMany.mockResolvedValue([
      { id: 'F1', folderId: 'f1', fileName: 'a.pdf', storageKey: 'src', mimeType: 'application/pdf', fileSizeBytes: BigInt(10), sha256: 'h' },
    ]);
    (svc as any).lockLiveDestinationFolder = jest.fn(async () => null); // FOR SHARE found nothing → trashed
    await svc.copyFolder('f1', { targetFolderId: 'dest' }, USER);
    expect(tx.databankFile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ folderId: null, storageKey: 'copy:src' }) }),
    );
  });

  it('8. excludes trashed files — the Phase-2 read filters deletedAt:null', async () => {
    const { svc, prisma } = harness();
    await svc.copyFolder('f1', { targetFolderId: 'dest' }, USER);
    expect((svc as any).collectSubtree).toHaveBeenCalled();
    expect(prisma.databankFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('9. skips an over-5GB file inside the subtree, reports it, and keeps copying — result is serializable', async () => {
    const { svc, tx, storage, prisma } = harness();
    tx.databankFolder.findMany.mockResolvedValue([{ id: 'f1', name: 'Docs', parentFolderId: null }]);
    prisma.databankFile.findMany.mockResolvedValue([
      { id: 'H', folderId: 'f1', fileName: 'huge.bin', storageKey: 'k-huge', mimeType: 'application/octet-stream', fileSizeBytes: BigInt(6 * 1024 ** 3), sha256: 'h1' },
      { id: 'O', folderId: 'f1', fileName: 'ok.pdf', storageKey: 'k-ok', mimeType: 'application/pdf', fileSizeBytes: BigInt(1024), sha256: 'h2' },
    ]);
    const res = await svc.copyFolder('f1', { targetFolderId: 'dest' }, USER);
    expect(storage.copyObject).toHaveBeenCalledTimes(1);
    expect(storage.copyObject.mock.calls[0][0]).toBe('k-ok'); // huge skipped before any byte copy
    expect(res.copiedFiles).toBe(1);
    expect(res.skipped).toEqual([{ fileName: 'huge.bin', reason: 'TOO_LARGE', sizeBytes: 6442450944 }]);
    expect(() => JSON.stringify(res)).not.toThrow(); // Number()'d size, not a raw BigInt
  });

  it('10. refuses a subtree of 1001 files up front and copies nothing (ceiling = the request budget)', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankFile.count.mockResolvedValue(1001);
    await expect(svc.copyFolder('f1', { targetFolderId: 'dest' }, USER)).rejects.toThrow(/too large to copy in one operation/);
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('11. refuses a subtree deeper than MAX_COPY_DEPTH before any write', async () => {
    const { svc, prisma, storage } = harness();
    // A linear chain f1(root) ← f2 ← … ← f55, source = f1.
    const ids = Array.from({ length: 55 }, (_, i) => `f${i + 1}`);
    const rows = ids.map((id, i) => ({ id, parentFolderId: i === 0 ? null : `f${i}` }));
    (svc as any).collectSubtree = jest.fn(async () => ids);
    prisma.databankFolder.findMany.mockResolvedValue(rows);
    await expect(svc.copyFolder('f1', { targetFolderId: 'dest' }, USER)).rejects.toThrow(/too large/);
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('12. NotFoundException when the source was trashed after being copied to the clipboard (stale-paste safety)', async () => {
    const { svc, tx, storage } = harness();
    (svc as any).loadFolderForRead = jest.fn().mockRejectedValue(new NotFoundException('Folder not found'));
    await expect(svc.copyFolder('STALE', { targetFolderId: 'dest' }, USER)).rejects.toThrow(NotFoundException);
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(tx.databankFolder.createMany).not.toHaveBeenCalled();
    expect(tx.databankFile.create).not.toHaveBeenCalled();
  });

  it('13. Phase-2 byte copies run OUTSIDE the scope-lock txn (skeleton commits, then one txn per file)', async () => {
    const { svc, tx, prisma, order } = harness();
    tx.databankFolder.findMany.mockResolvedValue([{ id: 'f1', name: 'Docs', parentFolderId: null }]);
    prisma.databankFile.findMany.mockResolvedValue([
      { id: 'F1', folderId: 'f1', fileName: 'a.pdf', storageKey: 'k', mimeType: 'application/pdf', fileSizeBytes: BigInt(10), sha256: 'h' },
    ]);
    await svc.copyFolder('f1', { targetFolderId: 'dest' }, USER);
    // skeleton createMany happens before the first byte copy
    expect(order.indexOf('folder.createMany')).toBeLessThan(order.indexOf('copyObject'));
    // one $transaction for Phase 1 + one per copied file
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
