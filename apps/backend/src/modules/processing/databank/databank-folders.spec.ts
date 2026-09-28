import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabankService } from './databank.service';

/**
 * Folder-structure writes (Databank Phase 1, PR-4): `folders/ensure-paths` and
 * the per-scope folder lock that create / rename / move / delete now share.
 * Prisma is a mock that records the ORDER of calls — the lock must come first
 * in every transaction. The transaction client is a SEPARATE object from the
 * service's prisma (which only has $transaction), so any folder read or write
 * that escaped the transaction would throw. No DB.
 */

const USER = { id: 'u1', permissions: ['processing.document.upload'] } as never;
const SCOPE = { clientId: 'c1', ownerUserId: null, storageFolder: 'databank/clients/c1' };
const LIVE = { id: 'f1', clientId: 'c1', ownerUserId: null, parentFolderId: null, name: 'Passport' };

function harness() {
  const log: string[] = [];
  const rec = (name: string, impl: (...a: any[]) => unknown = () => undefined) =>
    jest.fn(async (...a: any[]) => {
      log.push(name);
      return impl(...a);
    });
  const tx: Record<string, any> = {
    databankFolder: {
      findFirst: rec('folder.findFirst', () => null),
      findMany: rec('folder.findMany', () => []),
      create: rec('folder.create', (a) => ({ id: 'created', ...a.data })),
      createMany: rec('folder.createMany', (a) => ({ count: a.data.length })),
      update: rec('folder.update', (a) => ({ id: a.where.id, ...a.data })),
      updateMany: rec('folder.updateMany', () => ({ count: 1 })),
    },
    databankFile: { updateMany: rec('file.updateMany', () => ({ count: 0 })) },
    $executeRaw: rec('lock', () => 1),
    $queryRaw: rec('queryRaw', () => []),
  };
  const outer = {
    $transaction: jest.fn(async (fn: (t: unknown) => unknown, opts?: unknown) => {
      log.push(`txn:${JSON.stringify(opts)}`);
      return fn(tx);
    }),
  };
  const svc = new DatabankService(outer as never, {} as never);
  const s = svc as any;
  jest.spyOn(svc, 'resolveWriteScope').mockResolvedValue(SCOPE);
  s.loadFolder = jest.fn().mockResolvedValue(LIVE);
  s.assertClientWriteAccess = jest.fn().mockResolvedValue(undefined);
  // `prisma` below = the transaction client (where every folder query must go).
  return { svc, prisma: tx, outer, log };
}

/** The lock's key, from the tagged-template call `$executeRaw\`...${key}\``. */
const lockKey = (prisma: Record<string, any>, call = 0) => prisma.$executeRaw.mock.calls[call][1];
/** The lock's SQL text around the bound key. */
const lockSql = (prisma: Record<string, any>, call = 0) => prisma.$executeRaw.mock.calls[call][0].join('$1');

describe('DatabankService.ensureFolderPaths', () => {
  it('locks the scope FIRST, reads its folders once, creates what is missing, returns path → id', async () => {
    const { svc, prisma, log } = harness();
    prisma.databankFolder.findMany.mockImplementation(async () => {
      log.push('folder.findMany');
      return [{ id: 'p', parentFolderId: null, name: 'Passport', createdAt: new Date(0) }];
    });

    const out = await svc.ensureFolderPaths({ clientId: 'c1', paths: ['Passport/Scans', 'Passport'] }, USER);

    expect(log).toEqual(['txn:{"timeout":30000}', 'lock', 'folder.findMany', 'folder.createMany']);
    expect(lockKey(prisma)).toBe('databank-folders|client|c1');
    // [review] the TWO-key form, in its own namespace — never the single-key
    // hashtext space the upload commit's identity lock uses.
    expect(lockSql(prisma)).toBe('SELECT pg_advisory_xact_lock(1145194033, hashtext($1))');
    expect(prisma.databankFolder.findMany.mock.calls[0][0].where).toEqual({
      clientId: 'c1',
      ownerUserId: null,
      deletedAt: null,
    });
    const [row] = prisma.databankFolder.createMany.mock.calls[0][0].data;
    expect(row).toEqual({
      id: expect.any(String),
      parentFolderId: 'p',
      name: 'Scans',
      clientId: 'c1',
      ownerUserId: null,
      createdByUserId: 'u1',
    });
    expect(out).toEqual({ folders: { 'Passport/Scans': row.id, Passport: 'p' }, created: 1 });
  });

  it('writes nothing when every folder already exists (a retry returns the same ids)', async () => {
    const { svc, prisma } = harness();
    prisma.databankFolder.findMany.mockResolvedValue([
      { id: 'p', parentFolderId: null, name: 'Passport', createdAt: new Date(0) },
    ]);
    const out = await svc.ensureFolderPaths({ clientId: 'c1', paths: ['Passport'] }, USER);
    expect(prisma.databankFolder.createMany).not.toHaveBeenCalled();
    expect(out).toEqual({ folders: { Passport: 'p' }, created: 0 });
  });

  it('authorizes via resolveWriteScope (personal scope → the owner-keyed lock)', async () => {
    const { svc, prisma } = harness();
    (svc.resolveWriteScope as jest.Mock).mockResolvedValue({
      clientId: null,
      ownerUserId: 'u9',
      storageFolder: 'databank/users/u9',
    });
    await svc.ensureFolderPaths({ personal: true, paths: ['Notes'] }, USER, 'u9');
    expect(svc.resolveWriteScope).toHaveBeenCalledWith({ personal: true, paths: ['Notes'] }, USER, 'u9');
    expect(lockKey(prisma)).toBe('databank-folders|user|u9');
    expect(prisma.databankFolder.createMany.mock.calls[0][0].data[0]).toMatchObject({
      clientId: null,
      ownerUserId: 'u9',
    });
  });

  it('rejects a malformed path with a 400 naming it, BEFORE opening a transaction', async () => {
    const { svc, outer } = harness();
    const call = svc.ensureFolderPaths({ clientId: 'c1', paths: ['ok', 'Case/../x'] }, USER);
    await expect(call).rejects.toThrow(BadRequestException);
    await expect(call).rejects.toThrow('".." is not a valid folder name. (folder "Case/../x")');
    expect(outer.$transaction).not.toHaveBeenCalled();
  });

  it('shortens a very long offending path in the message', async () => {
    const { svc } = harness();
    const long = `${'a'.repeat(100)}/${'b'.repeat(121)}`;
    await expect(svc.ensureFolderPaths({ clientId: 'c1', paths: [long] }, USER)).rejects.toThrow(
      `(folder "${'a'.repeat(77)}...")`,
    );
  });

  it('checks the drop target UNDER the lock and 400s when it is not a live folder of this scope', async () => {
    const { svc, prisma, log } = harness();
    await expect(
      svc.ensureFolderPaths({ clientId: 'c1', parentFolderId: 'gone', paths: ['A'] }, USER),
    ).rejects.toThrow('Target folder does not exist in this databank');
    expect(log.slice(0, 3)).toEqual(['txn:{"timeout":30000}', 'lock', 'folder.findFirst']);
    expect(prisma.databankFolder.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'gone',
      deletedAt: null,
      clientId: 'c1',
      ownerUserId: null,
    });
    expect(prisma.databankFolder.createMany).not.toHaveBeenCalled();
  });

  it('inserts in chunks of 1,000 with every parent in the same or an earlier chunk', async () => {
    const { svc, prisma } = harness();
    // 1,250 top-level folders each holding one child → 2,500 new folders.
    const paths = Array.from({ length: 1250 }, (_, i) => `f${i}/child`);
    const out = await svc.ensureFolderPaths({ clientId: 'c1', paths }, USER);

    const chunks = prisma.databankFolder.createMany.mock.calls.map((c: any[]) => c[0].data);
    expect(chunks.map((c: unknown[]) => c.length)).toEqual([1000, 1000, 500]);
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const f of chunk) seen.add(f.id);
      for (const f of chunk) if (f.parentFolderId) expect(seen.has(f.parentFolderId)).toBe(true);
    }
    expect(out.created).toBe(2500);
  });
});

describe('the per-scope folder lock on hand-made folder writes', () => {
  it('createFolder: lock → parent check → "(2)" on a clash (a hand-made folder is always new)', async () => {
    const { svc, prisma, log } = harness();
    prisma.databankFolder.findFirst
      .mockImplementationOnce(async () => (log.push('folder.findFirst'), { id: 'parent' })) // parent live
      .mockImplementationOnce(async () => (log.push('folder.findFirst'), { id: 'clash' })) // "Scans" taken
      .mockImplementationOnce(async () => (log.push('folder.findFirst'), null)); // "Scans (2)" free
    const out = await svc.createFolder('c1', { name: ' Scans ', parentFolderId: 'parent' }, USER);
    expect(log[0]).toBe('txn:{"timeout":30000}');
    expect(log[1]).toBe('lock');
    expect(lockKey(prisma)).toBe('databank-folders|client|c1');
    expect(prisma.databankFolder.create.mock.calls[0][0].data).toEqual({
      clientId: 'c1',
      ownerUserId: null,
      parentFolderId: 'parent',
      name: 'Scans (2)',
      createdByUserId: 'u1',
    });
    expect(out.name).toBe('Scans (2)');
  });

  it('renameFolder: re-reads the folder under the lock — deleted since the auth check → 404, no write', async () => {
    const { svc, prisma, log } = harness();
    await expect(svc.renameFolder('f1', 'New', USER)).rejects.toThrow(NotFoundException);
    expect(log).toEqual(['txn:{"timeout":30000}', 'lock', 'folder.findFirst']);
    expect(prisma.databankFolder.update).not.toHaveBeenCalled();
  });

  it('moveFolder: the cycle check runs under the lock, before the update', async () => {
    const { svc, prisma, log } = harness();
    prisma.databankFolder.findFirst
      .mockImplementationOnce(async () => (log.push('folder.findFirst'), LIVE)) // reload
      .mockImplementationOnce(async () => (log.push('folder.findFirst'), { id: 'dest' })) // target live
      .mockImplementationOnce(async () => (log.push('folder.findFirst'), null)); // name free
    await svc.moveFolder('f1', 'dest', USER);
    expect(log).toEqual([
      'txn:{"timeout":30000}',
      'lock',
      'folder.findFirst',
      'folder.findFirst',
      'queryRaw', // assertNoCycle's ancestor walk
      'folder.findFirst',
      'folder.update',
    ]);
    expect(prisma.databankFolder.update.mock.calls[0][0].data).toEqual({ parentFolderId: 'dest', name: 'Passport' });
  });

  it('moveFolder: a move into its own subtree is refused', async () => {
    const { svc, prisma } = harness();
    prisma.databankFolder.findFirst.mockResolvedValueOnce(LIVE).mockResolvedValueOnce({ id: 'kid' });
    prisma.$queryRaw.mockResolvedValue([{ id: 'f1' }]);
    await expect(svc.moveFolder('f1', 'kid', USER)).rejects.toThrow('its own subtree');
    expect(prisma.databankFolder.update).not.toHaveBeenCalled();
  });

  it('deleteFolder: subtree collected UNDER the lock, folders trashed BEFORE files', async () => {
    const { svc, prisma, log } = harness();
    prisma.databankFolder.findFirst.mockImplementationOnce(async () => (log.push('folder.findFirst'), LIVE));
    prisma.$queryRaw.mockImplementation(async () => (log.push('queryRaw'), [{ id: 'f1' }, { id: 'f2' }]));
    const out = await svc.deleteFolder('f1', USER);
    expect(log).toEqual([
      'txn:{"timeout":30000}',
      'lock',
      'folder.findFirst', // re-read under the lock
      'queryRaw', // collectSubtree
      'folder.updateMany',
      'file.updateMany',
    ]);
    expect(prisma.databankFolder.updateMany.mock.calls[0][0].where).toEqual({
      id: { in: ['f1', 'f2'] },
      deletedAt: null,
    });
    expect(prisma.databankFile.updateMany.mock.calls[0][0].where).toEqual({
      folderId: { in: ['f1', 'f2'] },
      deletedAt: null,
    });
    expect(out).toEqual({ deletedFolders: 2 });
  });
});
