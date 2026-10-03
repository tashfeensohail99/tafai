import {
  BadRequestException,
  ConflictException,
  PreconditionFailedException,
} from '@nestjs/common';
import { DatabankService, DatabankTargetFileGoneError } from './databank.service';
import { DatabankTrashSweeperService } from './databank-trash-sweeper.service';

/**
 * Databank P3-2 — file versioning (service layer). Prisma and StorageService are
 * mocks; the transaction client is a SEPARATE object from the outer prisma, so a
 * write that escaped the per-file lock/txn would hit a different mock. No DB.
 * loadFile / loadFileForRead are stubbed so the tests exercise the version logic,
 * not the (separately tested) access model.
 */

const USER = { id: 'u1', permissions: ['processing.document.upload'] } as never;

/** A client-scoped file in the IMPLICIT-v1 state (currentVersionId NULL, no
 *  version rows) — how every existing/single-upload file starts. */
const CLIENT_FILE = {
  id: 'F1',
  clientId: 'c1',
  ownerUserId: null,
  folderId: null,
  fileName: 'passport.pdf',
  storageKey: 'databank/clients/c1/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: BigInt(10),
  sha256: 'oldhash',
  uploadedByUserId: 'u0',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  currentVersionId: null as string | null,
  versionSeq: 1,
};
const NEW_KEY = 'databank/clients/c1/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf';
const COMMIT_DTO = { storageKey: NEW_KEY, mimeType: 'application/pdf', fileSizeBytes: 20, sha256: 'newhash' };

/** Harness for the version service methods (commit / restore / delete / rename /
 *  list). The FOR UPDATE select ($queryRaw on tx) returns a row derived from
 *  `file`; version numbering is a stateful max so materialise-v1-then-v2 numbers
 *  correctly. */
function harness(file = CLIENT_FILE) {
  const order: string[] = [];
  let maxVersion = 0; // existing version rows; bumped by each create
  const tx: any = {
    databankFile: {
      updateMany: jest.fn(async () => (order.push('tx.file.updateMany'), { count: 1 })),
      findUniqueOrThrow: jest.fn(async (a: any) => (order.push('tx.file.findUniqueOrThrow'), { id: a.where.id })),
      // Used by deleteOwnUpload's global reference re-read. Default null = the key
      // is NOT referenced by any file mirror → safe to free.
      findFirst: jest.fn(async () => (order.push('tx.file.findFirst'), null)),
    },
    databankFileVersion: {
      // In-txn version-aware idempotency guard (under the per-file lock). Default
      // null = the key is NOT yet a version row → normal flow.
      findUnique: jest.fn(async () => (order.push('tx.version.findUnique'), null)),
      aggregate: jest.fn(async () => (order.push('tx.version.aggregate'), { _max: { versionNumber: maxVersion } })),
      create: jest.fn(async (a: any) => {
        order.push(`tx.version.create:v${a.data.versionNumber}`);
        maxVersion = Math.max(maxVersion, a.data.versionNumber);
        return { id: a.data.id, ...a.data };
      }),
      findFirst: jest.fn(async () => (order.push('tx.version.findFirst'), null)),
      deleteMany: jest.fn(async () => (order.push('tx.version.deleteMany'), { count: 1 })),
      updateMany: jest.fn(async () => (order.push('tx.version.updateMany'), { count: 1 })),
    },
    $executeRaw: jest.fn(async () => (order.push('lock'), 1)),
    $queryRaw: jest.fn(async () => (
      order.push('tx.queryRaw'),
      [
        {
          id: file.id,
          storageKey: file.storageKey,
          mimeType: file.mimeType,
          fileSizeBytes: file.fileSizeBytes,
          sha256: file.sha256,
          currentVersionId: file.currentVersionId,
          versionSeq: file.versionSeq,
          uploadedByUserId: file.uploadedByUserId,
          createdAt: file.createdAt,
        },
      ]
    )),
  };
  const prisma: any = {
    databankUpload: { findUnique: jest.fn(async () => null) },
    databankFile: {
      findUniqueOrThrow: jest.fn(async (a: any) => (order.push('file.findUniqueOrThrow'), { id: a.where.id })),
      findFirstOrThrow: jest.fn(async (a: any) => (order.push('file.findFirstOrThrow'), { id: a.where.id })),
      findFirst: jest.fn(async () => (order.push('file.findFirst'), null)),
    },
    databankFileVersion: {
      findUnique: jest.fn(async () => (order.push('version.findUnique'), null)),
      findMany: jest.fn(async () => (order.push('version.findMany'), [])),
    },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => (order.push('txn'), fn(tx))),
  };
  const storage = {
    headObjectMeta: jest.fn(async () => (order.push('head'), { exists: true, sizeBytes: 20 })),
    delete: jest.fn(async (k: string) => (order.push(`storage.delete:${k}`), undefined)),
    getSignedUrl: jest.fn(async (k: string) => `signed:${k}`),
    presignPutUrl: jest.fn(async () => ({ strategy: 'direct-put', storageKey: NEW_KEY, url: 'u', headers: {} })),
  };
  const svc = new DatabankService(prisma as never, storage as never);
  (svc as any).loadFile = jest.fn(async () => file);
  (svc as any).loadFileForRead = jest.fn(async () => file);
  return { svc, prisma, tx, storage, order };
}

describe('DatabankService — commitNewVersion', () => {
  it('materialises v1 from the mirror THEN appends v2, repoints current + mirror (frees nothing)', async () => {
    const { svc, tx, storage } = harness();
    await svc.commitNewVersion('F1', COMMIT_DTO as never, USER);

    expect(tx.databankFileVersion.create).toHaveBeenCalledTimes(2);
    const v1 = tx.databankFileVersion.create.mock.calls[0][0].data;
    expect(v1).toMatchObject({
      versionNumber: 1,
      storageKey: CLIENT_FILE.storageKey, // v1 = the file's ORIGINAL bytes
      createdByUserId: 'u0',
      createdAt: CLIENT_FILE.createdAt,
    });
    const v2 = tx.databankFileVersion.create.mock.calls[1][0].data;
    expect(v2).toMatchObject({ versionNumber: 2, storageKey: NEW_KEY, createdByUserId: 'u1' });

    const upd = tx.databankFile.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'F1', versionSeq: 1 }); // guarded compare-and-set
    expect(upd.data).toMatchObject({ currentVersionId: v2.id, storageKey: NEW_KEY, sha256: 'newhash', versionSeq: 2 });
    expect(storage.delete).not.toHaveBeenCalled(); // on success nothing is freed
  });

  it('a version-aware idempotent retry (key already a version of THIS file) returns the file, no HEAD/txn', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankFileVersion.findUnique.mockResolvedValueOnce({ fileId: 'F1' });
    const out = await svc.commitNewVersion('F1', COMMIT_DTO as never, USER);
    expect(out.id).toBe('F1');
    expect(storage.headObjectMeta).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('400s a key owned by ANOTHER file’s version, or by any DatabankFile', async () => {
    const a = harness();
    a.prisma.databankFileVersion.findUnique.mockResolvedValueOnce({ fileId: 'OTHER' });
    await expect(a.svc.commitNewVersion('F1', COMMIT_DTO as never, USER)).rejects.toBeInstanceOf(BadRequestException);

    const b = harness();
    b.prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'X' }); // some file already owns the key
    await expect(b.svc.commitNewVersion('F1', COMMIT_DTO as never, USER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a CONCURRENT same-key commit that adopted the key while we waited for the lock is a no-op (never deletes the now-live object)', async () => {
    // The pre-txn idempotency check passes (key not yet a version row), so we open
    // the txn — but under the lock a concurrent commit A has already made this key a
    // version of THIS file. We MUST return the file unchanged and delete NOTHING
    // (the key is now the live current object). Regression for the TOCTOU HIGH.
    const { svc, tx, storage } = harness();
    tx.databankFileVersion.findUnique.mockResolvedValueOnce({ fileId: 'F1' }); // adopted by A
    const out = await svc.commitNewVersion('F1', COMMIT_DTO as never, USER);
    expect(out.id).toBe('F1');
    expect(storage.delete).not.toHaveBeenCalled(); // the live object is never freed
    expect(tx.databankFileVersion.create).not.toHaveBeenCalled();
    expect(tx.databankFile.updateMany).not.toHaveBeenCalled();
  });

  it('a CONCURRENT commit that adopted the key for ANOTHER file is a 400 — and still deletes nothing', async () => {
    const { svc, tx, storage } = harness();
    tx.databankFileVersion.findUnique.mockResolvedValueOnce({ fileId: 'OTHER' });
    await expect(svc.commitNewVersion('F1', COMMIT_DTO as never, USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(tx.databankFileVersion.create).not.toHaveBeenCalled();
  });

  it('sha256 == CURRENT is a no-op: deletes the redundant object, creates no version, returns the file', async () => {
    const { svc, tx, storage } = harness();
    const out = await svc.commitNewVersion('F1', { ...COMMIT_DTO, sha256: 'oldhash' } as never, USER);
    expect(storage.delete).toHaveBeenCalledWith(NEW_KEY);
    expect(tx.databankFileVersion.create).not.toHaveBeenCalled();
    expect(tx.databankFile.updateMany).not.toHaveBeenCalled();
    expect(out.id).toBe('F1');
  });

  it('If-Match mismatch → 412 and FREES the just-uploaded object', async () => {
    const { svc, storage } = harness(); // versionSeq 1
    await expect(svc.commitNewVersion('F1', COMMIT_DTO as never, USER, '5')).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
    expect(storage.delete).toHaveBeenCalledWith(NEW_KEY);
  });

  it('on an early-exit (If-Match 412), does NOT delete the key if a concurrent SAME-CLIENT file adopted it meanwhile', async () => {
    // Regression for the round-2 cross-file race: lockFileVersions is per-file, so
    // another file Y of the same client can adopt dto.storageKey while we hold only
    // THIS file's lock. deleteOwnUpload must re-read globally and skip the delete so
    // Y's now-live current object is never destroyed.
    const { svc, tx, storage } = harness();
    tx.databankFileVersion.findUnique
      .mockResolvedValueOnce(null) // top adopted check: not yet adopted when we read
      .mockResolvedValueOnce({ id: 'vY' }); // inside deleteOwnUpload: file Y just adopted K
    await expect(svc.commitNewVersion('F1', COMMIT_DTO as never, USER, '5')).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
    expect(storage.delete).not.toHaveBeenCalled(); // Y's live current bytes preserved
  });
});

describe('DatabankService — attachUploadedVersion (resumable version core, P3 PR-2)', () => {
  // Runs INSIDE the upload-service commit's tx, under the per-file lock. Mirrors
  // commitNewVersion's core, minus presign/HEAD/If-Match (the resumable engine
  // already verified the object + size). The caller (commit) owns the session CAS.
  const INPUT = {
    targetFileId: 'F1',
    storageKey: NEW_KEY,
    mimeType: 'application/pdf',
    fileSizeBytes: 20,
    sha256: 'newhash',
    createdByUserId: 'u1',
    uploadSessionId: 'sess-1',
  };

  it('materialises v1 from the mirror THEN appends vN (carrying uploadSessionId), repoints current + mirror via a PLAIN update', async () => {
    const { svc, tx } = harness(); // implicit-v1 file (currentVersionId null)
    const out = await svc.attachUploadedVersion(tx as never, INPUT as never);
    expect(out.noop).toBe(false);
    expect((out.file as { id: string }).id).toBe('F1');
    expect(tx.databankFileVersion.create).toHaveBeenCalledTimes(2);
    const v1 = tx.databankFileVersion.create.mock.calls[0][0].data;
    expect(v1).toMatchObject({ versionNumber: 1, storageKey: CLIENT_FILE.storageKey, createdByUserId: 'u0', createdAt: CLIENT_FILE.createdAt });
    const v2 = tx.databankFileVersion.create.mock.calls[1][0].data;
    expect(v2).toMatchObject({ versionNumber: 2, storageKey: NEW_KEY, createdByUserId: 'u1', uploadSessionId: 'sess-1' });
    const upd = tx.databankFile.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'F1' }); // PLAIN update — no versionSeq compare-and-set
    expect(upd.data).toMatchObject({ currentVersionId: v2.id, storageKey: NEW_KEY, sha256: 'newhash', versionSeq: { increment: 1 } });
  });

  it('is idempotent when this session already owns a version row: returns the file, takes no lock, creates nothing', async () => {
    const { svc, tx } = harness();
    tx.databankFileVersion.findUnique.mockResolvedValueOnce({ fileId: 'F1' }); // a lost-reply / takeover retry
    const out = await svc.attachUploadedVersion(tx as never, INPUT as never);
    expect(out.noop).toBe(false);
    expect((out.file as { id: string }).id).toBe('F1');
    expect(tx.$executeRaw).not.toHaveBeenCalled(); // never took the per-file lock
    expect(tx.databankFileVersion.create).not.toHaveBeenCalled();
    expect(tx.databankFile.updateMany).not.toHaveBeenCalled();
  });

  it('sha256 == the CURRENT version is a no-op (noop:true): creates NO version, leaves the file unchanged', async () => {
    const { svc, tx } = harness();
    const out = await svc.attachUploadedVersion(tx as never, { ...INPUT, sha256: 'oldhash' } as never); // == CLIENT_FILE.sha256
    expect(out.noop).toBe(true);
    expect((out.file as { id: string }).id).toBe('F1');
    expect(tx.databankFileVersion.create).not.toHaveBeenCalled();
    expect(tx.databankFile.updateMany).not.toHaveBeenCalled();
  });

  it('a target file trashed/removed mid-upload (FOR UPDATE finds nothing) → throws DatabankTargetFileGoneError', async () => {
    const { svc, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([]); // the live-file FOR UPDATE finds no row
    await expect(svc.attachUploadedVersion(tx as never, INPUT as never)).rejects.toBeInstanceOf(DatabankTargetFileGoneError);
    expect(tx.databankFileVersion.create).not.toHaveBeenCalled();
    expect(tx.databankFile.updateMany).not.toHaveBeenCalled();
  });
});

describe('DatabankService — restoreVersion (repoint only)', () => {
  const MAT = { ...CLIENT_FILE, currentVersionId: 'vCur', versionSeq: 3 };

  it('repoints currentVersionId + mirrors the version’s bytes; frees NOTHING', async () => {
    const { svc, tx, storage } = harness(MAT);
    tx.databankFileVersion.findFirst.mockResolvedValueOnce({
      id: 'vOld', storageKey: 'kold', mimeType: 'application/pdf', fileSizeBytes: BigInt(5), sha256: 'h5',
    });
    await svc.restoreVersion('F1', 'vOld', USER);
    expect(tx.databankFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'F1', versionSeq: 3 },
        data: expect.objectContaining({ currentVersionId: 'vOld', storageKey: 'kold', versionSeq: 4 }),
      }),
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('is an idempotent no-op when the version is already current', async () => {
    const { svc, tx } = harness(MAT);
    tx.databankFileVersion.findFirst.mockResolvedValueOnce({ id: 'vCur', storageKey: 'kcur' });
    await svc.restoreVersion('F1', 'vCur', USER);
    expect(tx.databankFile.updateMany).not.toHaveBeenCalled();
  });

  it('If-Match mismatch → 412', async () => {
    const { svc, tx } = harness(MAT);
    tx.databankFileVersion.findFirst.mockResolvedValueOnce({ id: 'vOld', storageKey: 'kold' });
    await expect(svc.restoreVersion('F1', 'vOld', USER, '5')).rejects.toBeInstanceOf(PreconditionFailedException);
  });
});

describe('DatabankService — deleteVersion (storage reclaim)', () => {
  const MAT = { ...CLIENT_FILE, currentVersionId: 'vCur', versionSeq: 3 };

  it('REFUSES the current version (409) and frees nothing', async () => {
    const { svc, tx, storage } = harness(MAT);
    tx.databankFileVersion.findFirst.mockResolvedValueOnce({ id: 'vCur', storageKey: 'kcur' });
    await expect(svc.deleteVersion('F1', 'vCur', USER)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.databankFileVersion.deleteMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes a NON-current version THEN frees its sole-referenced key, in that order', async () => {
    const { svc, tx, storage, order } = harness(MAT);
    tx.databankFileVersion.findFirst.mockResolvedValueOnce({ id: 'vOld', storageKey: 'kold' });
    const out = await svc.deleteVersion('F1', 'vOld', USER);
    expect(tx.databankFileVersion.deleteMany).toHaveBeenCalledWith({ where: { id: 'vOld', fileId: 'F1' } });
    expect(order.indexOf('tx.version.deleteMany')).toBeLessThan(order.indexOf('storage.delete:kold'));
    expect(storage.delete).toHaveBeenCalledWith('kold');
    expect(out).toEqual({ id: 'vOld', deleted: true });
  });

  it('If-Match mismatch → 412', async () => {
    const { svc } = harness(MAT);
    await expect(svc.deleteVersion('F1', 'vOld', USER, '5')).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it('does NOT free the key if a concurrent commit re-adopted it between the delete-commit and the free', async () => {
    // Regression: deleteVersion frees after its txn. A racing commitNewVersion that
    // re-adopted the key (now a live version row) must keep its bytes.
    const { svc, tx, prisma, storage } = harness(MAT);
    tx.databankFileVersion.findFirst.mockResolvedValueOnce({ id: 'vOld', storageKey: 'kold' });
    prisma.databankFileVersion.findUnique.mockResolvedValueOnce({ id: 'vReadopted' }); // kold is referenced again
    await svc.deleteVersion('F1', 'vOld', USER);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('does NOT free the key if it was re-adopted as a file mirror', async () => {
    const { svc, tx, prisma, storage } = harness(MAT);
    tx.databankFileVersion.findFirst.mockResolvedValueOnce({ id: 'vOld', storageKey: 'kold' });
    prisma.databankFileVersion.findUnique.mockResolvedValueOnce(null); // no version row…
    prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'Freadopt' }); // …but a file mirror now points at it
    await svc.deleteVersion('F1', 'vOld', USER);
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe('DatabankService — renameVersion', () => {
  it('If-Match mismatch → 412', async () => {
    const { svc } = harness({ ...CLIENT_FILE, versionSeq: 3 });
    await expect(svc.renameVersion('F1', 'vOld', 'Signed final', USER, '5')).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
  });

  it('sets the label and bumps versionSeq', async () => {
    const { svc, tx } = harness({ ...CLIENT_FILE, currentVersionId: 'v2', versionSeq: 3 });
    await svc.renameVersion('F1', 'vOld', '  Signed final  ', USER);
    expect(tx.databankFileVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'vOld', fileId: 'F1' },
      data: { name: 'Signed final' },
    });
    expect(tx.databankFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'F1', versionSeq: 3 },
      data: { versionSeq: 4 },
    });
  });
});

describe('DatabankService — listVersions', () => {
  it('implicit-v1 state returns a single SYNTHETIC current entry (id:null) from the mirror', async () => {
    const { svc, prisma } = harness(); // currentVersionId null, versionSeq 1
    prisma.databankFileVersion.findMany.mockResolvedValueOnce([]);
    const out = await svc.listVersions('F1', USER);
    expect(out.etag).toBe('W/"1"');
    expect(out.versions).toHaveLength(1);
    expect(out.versions[0]).toMatchObject({
      id: null,
      versionNumber: 1,
      isCurrent: true,
      fileSizeBytes: CLIENT_FILE.fileSizeBytes,
      mimeType: CLIENT_FILE.mimeType,
    });
  });

  it('materialised state flags the row whose id == currentVersionId as current, newest first', async () => {
    const file = { ...CLIENT_FILE, currentVersionId: 'v2', versionSeq: 2 };
    const { svc, prisma } = harness(file);
    prisma.databankFileVersion.findMany.mockResolvedValueOnce([
      { id: 'v2', versionNumber: 2, name: null, fileSizeBytes: BigInt(20), mimeType: 'application/pdf', sha256: 'newhash', createdByUserId: 'u1', createdAt: new Date() },
      { id: 'v1', versionNumber: 1, name: null, fileSizeBytes: BigInt(10), mimeType: 'application/pdf', sha256: 'oldhash', createdByUserId: 'u0', createdAt: new Date() },
    ]);
    const out = await svc.listVersions('F1', USER);
    expect(out.etag).toBe('W/"2"');
    expect((out.versions.find((v: any) => v.id === 'v2') as any).isCurrent).toBe(true);
    expect((out.versions.find((v: any) => v.id === 'v1') as any).isCurrent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — free the DEDUPED union {file.storageKey} ∪ {version keys}, version
// keys captured BEFORE the FK cascade, each object freed EXACTLY once, survivors
// skipped.
// ---------------------------------------------------------------------------

function lifecycleHarness() {
  const order: string[] = [];
  const tx: any = {
    databankFile: {
      deleteMany: jest.fn(async () => (order.push('tx.file.deleteMany'), { count: 1 })),
      findMany: jest.fn(async () => (order.push('tx.file.findMany'), [])),
      updateMany: jest.fn(async () => (order.push('tx.file.updateMany'), { count: 0 })),
    },
    databankFileVersion: {
      findMany: jest.fn(async () => (order.push('tx.version.findMany'), [])),
    },
    databankFolder: {
      findFirst: jest.fn(async () => (order.push('tx.folder.findFirst'), null)),
      deleteMany: jest.fn(async () => (order.push('tx.folder.deleteMany'), { count: 1 })),
    },
    $executeRaw: jest.fn(async () => (order.push('lock'), 1)),
    $queryRaw: jest.fn(async () => (order.push('tx.queryRaw'), [])),
  };
  const prisma: any = {
    databankFile: { findFirst: jest.fn(async () => null) },
    databankFolder: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => (order.push('txn'), fn(tx))),
  };
  const storage = { delete: jest.fn(async (k: string) => (order.push(`storage.delete:${k}`), undefined)) };
  const svc = new DatabankService(prisma as never, storage as never);
  (svc as any).authorizeRow = jest.fn().mockResolvedValue(undefined);
  return { svc, prisma, tx, storage, order };
}

describe('DatabankService — purge frees the deduped version union', () => {
  it('purgeFile captures version keys BEFORE the delete and frees {file key} ∪ {version keys} once each', async () => {
    const { svc, prisma, tx, storage, order } = lifecycleHarness();
    prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'F1', clientId: null, ownerUserId: 'u1', storageKey: 'k2' });
    // v1 = 'k1'; v2 = 'k2' is the CURRENT object → also the file mirror key.
    tx.databankFileVersion.findMany.mockResolvedValueOnce([{ storageKey: 'k1' }, { storageKey: 'k2' }]);

    const out = await svc.purgeFile('F1', USER);

    expect(order.indexOf('tx.version.findMany')).toBeLessThan(order.indexOf('tx.file.deleteMany'));
    // k2 appears in the mirror AND its version row → freed EXACTLY once (no double-free).
    expect(storage.delete.mock.calls).toEqual([['k2'], ['k1']]);
    expect(out).toEqual({ id: 'F1', purged: true });
  });

  it('purgeFolder frees the deduped union across every trashed file in the subtree', async () => {
    const { svc, prisma, tx, storage, order } = lifecycleHarness();
    prisma.databankFolder.findFirst.mockResolvedValueOnce({ id: 'FD', clientId: null, ownerUserId: 'u1' });
    tx.databankFolder.findFirst.mockResolvedValueOnce({ id: 'FD', clientId: null, ownerUserId: 'u1' }); // reload
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'FD' }]); // subtree
    tx.databankFile.findMany.mockResolvedValueOnce([
      { id: 'A', storageKey: 'kA' },
      { id: 'B', storageKey: 'kB' },
    ]);
    // A has a prior version kA1 + its current twin kA; B is single-version (kB).
    tx.databankFileVersion.findMany.mockResolvedValueOnce([
      { storageKey: 'kA1' },
      { storageKey: 'kA' },
      { storageKey: 'kB' },
    ]);

    const out = await svc.purgeFolder('FD', USER);

    expect(order.indexOf('tx.version.findMany')).toBeLessThan(order.indexOf('tx.file.deleteMany'));
    expect(storage.delete.mock.calls).toEqual([['kA'], ['kB'], ['kA1']]); // deduped, kA once
    expect(out).toEqual({ purgedFolders: 1, purgedFiles: 2 });
  });
});

// ---------------------------------------------------------------------------
// Retention sweeper — version keys
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
    databankFileVersion: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const sweeper = new DatabankTrashSweeperService(prisma as never, storage as never);
  return { sweeper, prisma, storage };
}

describe('DatabankTrashSweeperService — version keys', () => {
  it('purgeAgedFiles frees {file key} ∪ {version keys} once each for a reaped file', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', '30', async () => {
      const h = sweeperHarness();
      h.prisma.databankFile.findMany
        .mockResolvedValueOnce([{ id: 'a', storageKey: 'ka2' }]) // candidate (current = ka2)
        .mockResolvedValueOnce([]); // survivors: none → truly gone
      h.prisma.databankFileVersion.findMany.mockResolvedValueOnce([
        { fileId: 'a', storageKey: 'ka1' },
        { fileId: 'a', storageKey: 'ka2' }, // current twin
      ]);
      await h.sweeper.sweep(NOW);
      expect(h.storage.delete.mock.calls).toEqual([['ka2'], ['ka1']]); // ka2 freed once
    });
  });

  it('purgeAgedFiles frees NEITHER the file NOR its version keys for a restored survivor', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', '30', async () => {
      const h = sweeperHarness();
      h.prisma.databankFile.findMany
        .mockResolvedValueOnce([{ id: 'a', storageKey: 'ka' }]) // candidate
        .mockResolvedValueOnce([{ id: 'a' }]); // survived → restored
      h.prisma.databankFileVersion.findMany.mockResolvedValueOnce([{ fileId: 'a', storageKey: 'kaV' }]);
      await h.sweeper.sweep(NOW);
      expect(h.storage.delete).not.toHaveBeenCalled();
    });
  });

  it('purgeAgedFolders frees a descendant file’s bytes + version keys under the FULL cascade reach', async () => {
    await withEnv('DATABANK_TRASH_RETENTION_DAYS', '30', async () => {
      const h = sweeperHarness();
      h.prisma.databankFile.findMany
        .mockResolvedValueOnce([]) // purgeAgedFiles: none
        .mockResolvedValueOnce([{ id: 'x', storageKey: 'kx' }]) // reach capture (current = kx)
        .mockResolvedValueOnce([]); // survivors: gone
      h.prisma.databankFileVersion.findMany.mockResolvedValueOnce([
        { fileId: 'x', storageKey: 'kx1' },
        { fileId: 'x', storageKey: 'kx' }, // current twin
      ]);
      h.prisma.databankFolder.findMany
        .mockResolvedValueOnce([{ id: 'A' }])
        .mockResolvedValueOnce([]);
      h.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'A' }, { id: 'B' }]); // A's cascade reach
      h.prisma.databankFolder.deleteMany.mockResolvedValueOnce({ count: 1 });

      await h.sweeper.sweep(NOW);

      expect(h.storage.delete.mock.calls).toEqual([['kx'], ['kx1']]); // kx freed once
    });
  });
});
