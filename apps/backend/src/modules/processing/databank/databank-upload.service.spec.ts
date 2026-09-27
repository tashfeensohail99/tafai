import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabankUploadService } from './databank-upload.service';
import { GiB, MiB } from './upload-plan';

/**
 * Unit tests for resumable databank uploads (Databank Phase 1). Prisma, storage
 * and DatabankService are mocks — no DB, no R2. Each test states the storage /
 * DB situation and asserts the service's decision.
 */

const USER = { id: 'u1', permissions: ['processing.document.upload'] } as never;
const SCOPE = { clientId: 'c1', ownerUserId: null, storageFolder: 'databank/clients/c1' };
const H = (ch: string) => ch.repeat(64); // a valid lower-case hex sha256
const nosuch = () => Object.assign(new Error('gone'), { name: 'NoSuchUpload' });

function harness() {
  const prisma = {
    databankFolder: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    databankUpload: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    databankFile: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'new-file' }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const storage = {
    supportsDirectUpload: true,
    uploadUrlTtlSeconds: 21600,
    createMultipartUpload: jest.fn().mockResolvedValue('r2-new'),
    presignUploadPart: jest.fn(async (k: string, _u: string, n: number) => `https://r2/${k}?partNumber=${n}`),
    presignPutForKey: jest.fn(async (k: string, m: string) => ({ url: `https://r2/${k}`, headers: { 'Content-Type': m } })),
    listAllParts: jest.fn(),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    headObjectMeta: jest.fn().mockResolvedValue({ exists: false }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const databank = {
    resolveWriteScope: jest.fn().mockResolvedValue(SCOPE),
    assertSafeFileName: jest.fn((n: string) => {
      if (/\.exe$/i.test(n)) throw new BadRequestException('Files of type .exe are not allowed.');
    }),
    fileSelect: { id: true },
  };
  const svc = new DatabankUploadService(prisma as never, storage as never, databank as never);
  return { svc, prisma, storage, databank };
}

/** A 40 MiB multipart session: 5 × 8 MiB parts. */
const session = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  createdByUserId: 'u1',
  clientId: 'c1',
  ownerUserId: null,
  folderId: null,
  relativePath: null,
  fileName: 'big.zip',
  mimeType: 'application/zip',
  sizeBytes: BigInt(40 * MiB),
  fileLastModified: null,
  sha256: H('a'),
  strategy: 'MULTIPART',
  storageKey: 'databank/clients/c1/k.zip',
  r2UploadId: 'r2-up',
  partSize: 8 * MiB,
  partCount: 5,
  status: 'UPLOADING',
  completingAt: null,
  failureReason: null,
  r2CleanedAt: null,
  fileId: null,
  expiresAt: new Date(Date.now() + 86_400_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});
const parts = (n: number, size = 8 * MiB) =>
  Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, etag: `"e${i + 1}"`, sizeBytes: size }));

describe('DatabankUploadService.init', () => {
  it('authorizes first, then falls back to the proxy path in dev storage modes', async () => {
    const { svc, storage, databank } = harness();
    storage.supportsDirectUpload = false;
    const res = await svc.init({ clientId: 'c1', files: [] } as never, USER);
    expect(res).toEqual({ mode: 'proxy' });
    expect(databank.resolveWriteScope).toHaveBeenCalled();
  });

  it('resolves each file in order: resume → already-uploaded → duplicate → possible-duplicate → rejected → new', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.findMany.mockResolvedValueOnce([session()]); // open session for big.zip
    storage.listAllParts.mockResolvedValueOnce(parts(2)); // parts 1-2 already in R2
    prisma.databankFile.findMany
      .mockResolvedValueOnce([
        { id: 'fb', fileName: 'same.pdf', folderId: null, createdAt: new Date(), sha256: H('b'), folder: null },
      ]) // by-hash
      .mockResolvedValueOnce([
        { id: 'fc', fileName: 'old.pdf', folderId: null, createdAt: new Date(), fileSizeBytes: 1000n, folder: null },
      ]); // legacy (no hash)

    const f = (fileName: string, sizeBytes: number, sha: string, extra: Record<string, unknown> = {}) => ({
      fileName, sizeBytes, sha256: H(sha), mimeType: 'application/octet-stream', ...extra,
    });
    const res = await svc.init(
      {
        clientId: 'c1',
        files: [
          f('big.zip', 40 * MiB, 'a'), // 0 resume
          f('same.pdf', 500, 'b'), // 1 already-uploaded (same folder + name + hash)
          f('copy.pdf', 500, 'b'), // 2 duplicate (same hash elsewhere)
          f('copy2.pdf', 500, 'b', { allowDuplicate: true }), // 3 new (duplicate allowed)
          f('old.pdf', 1000, 'c'), // 4 possible-duplicate (legacy, no hash)
          f('virus.exe', 10, 'd'), // 5 rejected (blocked type)
          f('huge.iso', 51 * GiB, 'e'), // 6 rejected (over the 50 GiB cap)
          f('lost.pdf', 10, 'f', { folderId: '11111111-1111-4111-8111-111111111111' }), // 7 rejected (folder gone)
          f('video.mp4', 100 * MiB, '9'), // 8 new multipart
        ],
      } as never,
      USER,
    );

    if (res.mode !== 'direct') throw new Error('expected direct mode');
    expect(res.results.map((r) => r.status)).toEqual([
      'upload', 'already-uploaded', 'duplicate', 'upload', 'possible-duplicate',
      'rejected', 'rejected', 'rejected', 'upload',
    ]);

    const resumed = res.results[0] as Extract<(typeof res.results)[number], { status: 'upload' }>;
    expect(resumed).toMatchObject({ uploadId: 's1', resumed: true, doneParts: [1, 2], partCount: 5 });
    expect(resumed.urls.map((u) => u.partNumber)).toEqual([3, 4, 5]); // only what's missing

    expect(res.results[2]).toMatchObject({ existing: { id: 'fb', fileName: 'same.pdf' } });
    expect(res.results[4]).toMatchObject({ existing: { id: 'fc' } });

    // Exactly ONE insert, for the two genuinely new files; sizes stored as BigInt.
    expect(prisma.databankUpload.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.databankUpload.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { fileName: string }) => r.fileName)).toEqual(['copy2.pdf', 'video.mp4']);
    expect(rows[0]).toMatchObject({ strategy: 'SINGLE', sizeBytes: 500n, r2UploadId: null });
    expect(rows[1]).toMatchObject({ strategy: 'MULTIPART', sizeBytes: BigInt(100 * MiB), partSize: 8 * MiB, partCount: 13 });
    // Only the multipart file opens an R2 upload.
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);

    const video = res.results[8] as Extract<(typeof res.results)[number], { status: 'upload' }>;
    expect(video.urls.map((u) => u.partNumber)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    const small = res.results[3] as Extract<(typeof res.results)[number], { status: 'upload' }>;
    expect(small).toMatchObject({ strategy: 'SINGLE', partCount: 1 });
    expect(small.urls[0].headers).toEqual({ 'Content-Type': 'application/octet-stream' });
  });

  it('starts over when R2 has lost a resumable session (NoSuchUpload)', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.findMany.mockResolvedValueOnce([session()]);
    storage.listAllParts.mockRejectedValueOnce(nosuch());
    const res = await svc.init(
      { clientId: 'c1', files: [{ fileName: 'big.zip', sizeBytes: 40 * MiB, sha256: H('a'), mimeType: 'application/zip' }] } as never,
      USER,
    );
    expect(prisma.databankUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ status: 'ABORTED' }) }),
    );
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(res.mode === 'direct' && res.results[0]).toMatchObject({ status: 'upload', resumed: false });
  });

  it('aborts freshly created R2 uploads if recording the sessions fails', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.createMany.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.init(
        { clientId: 'c1', files: [{ fileName: 'v.mp4', sizeBytes: 100 * MiB, sha256: H('a'), mimeType: 'video/mp4' }] } as never,
        USER,
      ),
    ).rejects.toThrow('db down');
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(expect.any(String), 'r2-new');
  });
});

describe('DatabankUploadService.complete / finalize', () => {
  const complete = (h: ReturnType<typeof harness>, s = session()) => {
    h.prisma.databankUpload.findMany.mockResolvedValueOnce([s]);
    return h.svc.complete({ ids: [s.id] } as never, USER).then((r) => r.results[0]);
  };

  it('verifies every part, completes with ListParts ETags, then records the file', async () => {
    const h = harness();
    h.storage.headObjectMeta
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.storage.listAllParts.mockResolvedValueOnce(parts(5).reverse());
    const res = await complete(h);
    expect(res).toMatchObject({ status: 'completed', file: { id: 'new-file' } });
    expect(h.storage.completeMultipartUpload).toHaveBeenCalledWith('databank/clients/c1/k.zip', 'r2-up', [
      { partNumber: 1, etag: '"e1"' }, { partNumber: 2, etag: '"e2"' }, { partNumber: 3, etag: '"e3"' },
      { partNumber: 4, etag: '"e4"' }, { partNumber: 5, etag: '"e5"' },
    ]);
    expect(h.prisma.databankFile.create.mock.calls[0][0].data).toMatchObject({
      fileSizeBytes: BigInt(40 * MiB), sha256: H('a'), uploadSessionId: 's1', source: 'UPLOAD', folderId: null,
    });
  });

  it('recovers a complete that died after R2 finished (HEAD-first → straight to commit)', async () => {
    const h = harness();
    h.storage.headObjectMeta.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    const res = await complete(h);
    expect(res.status).toBe('completed');
    expect(h.storage.listAllParts).not.toHaveBeenCalled();
    expect(h.storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('reports missing parts and hands the session back to UPLOADING', async () => {
    const h = harness();
    h.storage.listAllParts.mockResolvedValueOnce(parts(5).filter((p) => p.partNumber !== 3));
    const res = await complete(h);
    expect(res).toEqual({ id: 's1', status: 'missing-parts', missingParts: [3] });
    expect(h.prisma.databankUpload.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'UPLOADING', completingAt: null } }),
    );
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('treats NoSuchUpload on complete as "maybe a racing finalize won" and lets HEAD decide', async () => {
    const h = harness();
    h.storage.headObjectMeta
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.storage.listAllParts.mockResolvedValueOnce(parts(5));
    h.storage.completeMultipartUpload.mockRejectedValueOnce(nosuch());
    expect((await complete(h)).status).toBe('completed');
  });

  it('deletes and FAILS an object whose size is not exactly the declared file', async () => {
    const h = harness();
    h.storage.headObjectMeta
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB - 1 });
    h.storage.listAllParts.mockResolvedValueOnce(parts(5));
    const res = await complete(h);
    expect(res.status).toBe('failed');
    expect(h.storage.delete).toHaveBeenCalledWith('databank/clients/c1/k.zip');
    expect(h.prisma.databankFile.create).not.toHaveBeenCalled();
  });

  it('returns the winning row when a racing finalizer already recorded the file (P2002)', async () => {
    const h = harness();
    h.storage.headObjectMeta.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    h.prisma.databankFile.findUnique.mockResolvedValueOnce({ id: 'winner' });
    expect(await complete(h)).toMatchObject({ status: 'completed', file: { id: 'winner' } });
  });

  it('aborts and frees storage when the user lost access to the databank', async () => {
    const h = harness();
    h.databank.resolveWriteScope.mockRejectedValueOnce(new ForbiddenException('nope'));
    const res = await complete(h);
    expect(res.status).toBe('failed');
    expect(h.prisma.databankUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ABORTED', failureReason: 'access revoked' }) }),
    );
    expect(h.storage.abortMultipartUpload).toHaveBeenCalledWith('databank/clients/c1/k.zip', 'r2-up');
  });

  it('files the upload at the root (relocated) when its folder was deleted mid-upload', async () => {
    const h = harness();
    h.prisma.databankFolder.findFirst.mockResolvedValueOnce(null);
    h.storage.headObjectMeta.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    const res = await complete(h, session({ folderId: 'deleted-folder' }));
    expect(res).toMatchObject({ status: 'completed', relocated: true });
    expect(h.prisma.databankFile.create.mock.calls[0][0].data.folderId).toBeNull();
  });

  it('does not double-finish: a lost claim reports the settled state', async () => {
    const h = harness();
    h.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 }); // someone else holds it
    h.prisma.databankUpload.findUnique.mockResolvedValueOnce(session({ status: 'COMPLETED', fileId: 'f9' }));
    h.prisma.databankFile.findUnique.mockResolvedValueOnce({ id: 'f9' });
    expect(await complete(h)).toMatchObject({ status: 'completed', file: { id: 'f9' } });

    const h2 = harness();
    h2.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    h2.prisma.databankUpload.findUnique.mockResolvedValueOnce(session({ status: 'COMPLETING' }));
    expect(await complete(h2)).toEqual({ id: 's1', status: 'in-progress' });
    expect(h2.storage.headObjectMeta).not.toHaveBeenCalled();
  });

  it('claims atomically: only UPLOADING, or a COMPLETING claim older than 15 minutes', async () => {
    const h = harness();
    h.storage.headObjectMeta.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    await complete(h);
    const where = h.prisma.databankUpload.updateMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ status: 'UPLOADING' });
    expect(where.OR[1].status).toBe('COMPLETING');
    const age = Date.now() - where.OR[1].completingAt.lt.getTime();
    expect(age).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
  });

  it('hands the claim back and asks to retry on a transient storage error', async () => {
    const h = harness();
    h.storage.listAllParts.mockRejectedValueOnce(new Error('503 from storage'));
    const res = await complete(h);
    expect(res).toMatchObject({ status: 'retry' });
    expect(h.prisma.databankUpload.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'UPLOADING', completingAt: null } }),
    );
  });

  it('marks an upload R2 no longer has (and no object) as expired', async () => {
    const h = harness();
    h.storage.listAllParts.mockRejectedValueOnce(nosuch());
    expect(await complete(h)).toEqual({ id: 's1', status: 'expired' });
  });

  it('reports part 1 missing for a single-PUT upload the browser has not finished', async () => {
    const h = harness();
    const res = await complete(h, session({ strategy: 'SINGLE', r2UploadId: null, partSize: null, partCount: null }));
    expect(res).toEqual({ id: 's1', status: 'missing-parts', missingParts: [1] });
  });

  it("reports not-found for ids that aren't the caller's sessions", async () => {
    const h = harness();
    h.prisma.databankUpload.findMany.mockResolvedValueOnce([]);
    const { results } = await h.svc.complete({ ids: ['nope'] } as never, USER);
    expect(results).toEqual([{ id: 'nope', status: 'not-found' }]);
  });
});

describe('DatabankUploadService.abort', () => {
  it('cancels an in-progress upload and frees its R2 parts', async () => {
    const h = harness();
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ status: 'ABORTED' }));
    expect(await h.svc.abort('s1', USER)).toEqual({ id: 's1', status: 'aborted' });
    expect(h.storage.abortMultipartUpload).toHaveBeenCalledWith('databank/clients/c1/k.zip', 'r2-up');
  });

  it('refuses to cancel once completion has started (409)', async () => {
    const h = harness();
    h.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ status: 'COMPLETING' }));
    await expect(h.svc.abort('s1', USER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('is idempotent for an already-cancelled upload, and 404s for a stranger', async () => {
    const h = harness();
    h.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ status: 'ABORTED' }));
    expect(await h.svc.abort('s1', USER)).toEqual({ id: 's1', status: 'aborted' });

    const h2 = harness();
    h2.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    h2.prisma.databankUpload.findFirst.mockResolvedValueOnce(null);
    await expect(h2.svc.abort('s1', USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never deletes an object that a DatabankFile still references', async () => {
    const h = harness();
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ status: 'ABORTED' }));
    h.prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'live-file' });
    await h.svc.abort('s1', USER);
    expect(h.storage.delete).not.toHaveBeenCalled();
  });
});

describe('DatabankUploadService.signParts', () => {
  it('signs the requested parts, de-duplicated and in order', async () => {
    const h = harness();
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session());
    const { parts: signed } = await h.svc.signParts('s1', { partNumbers: [4, 2, 4] } as never, USER);
    expect(signed.map((p) => p.partNumber)).toEqual([2, 4]);
  });

  it('rejects out-of-range parts, expired sessions and finished sessions', async () => {
    const h = harness();
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session());
    await expect(h.svc.signParts('s1', { partNumbers: [6] } as never, USER)).rejects.toBeInstanceOf(BadRequestException);

    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ expiresAt: new Date(Date.now() - 1) }));
    await expect(h.svc.signParts('s1', { partNumbers: [1] } as never, USER)).rejects.toBeInstanceOf(GoneException);

    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ status: 'COMPLETED' }));
    await expect(h.svc.signParts('s1', { partNumbers: [1] } as never, USER)).rejects.toBeInstanceOf(ConflictException);

    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.signParts('s1', { partNumbers: [1] } as never, USER)).rejects.toBeInstanceOf(NotFoundException);
  });
});
