import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabankUploadService, safeMimeType } from './databank-upload.service';
import { GiB, MiB } from './upload-plan';

/**
 * Unit tests for resumable databank uploads (Databank Phase 1). Prisma, storage
 * and DatabankService are mocks — no DB, no R2. Each test states the storage /
 * DB situation and asserts the service's decision. Tests marked [review] are
 * regressions for findings from the adversarial review.
 */

const USER = { id: 'u1', permissions: ['processing.document.upload'] } as never;
const SCOPE = { clientId: 'c1', ownerUserId: null, storageFolder: 'databank/clients/c1' };
const H = (ch: string) => ch.repeat(64); // a valid lower-case hex sha256
const nosuch = () => Object.assign(new Error('gone'), { name: 'NoSuchUpload' });

function harness() {
  const prisma: Record<string, any> = {
    databankFolder: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    databankUpload: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    databankFile: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'new-file' }),
    },
  };
  // Interactive transactions run the callback against the same mocks.
  prisma.$transaction = jest.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
  const storage = {
    supportsDirectUpload: true,
    uploadUrlTtlSeconds: 21600,
    createMultipartUpload: jest.fn().mockResolvedValue('r2-new'),
    presignUploadPart: jest.fn(async (k: string, _u: string, n: number) => `https://r2/${k}?partNumber=${n}`),
    presignPutForKey: jest.fn(async (k: string, m: string) => ({ url: `https://r2/${k}`, headers: { 'Content-Type': m } })),
    listAllParts: jest.fn(),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    headObjectStrict: jest.fn().mockResolvedValue({ exists: false }),
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
  updatedAt: new Date(Date.now() - 7 * 3600_000), // older than the 6 h URL TTL
  ...over,
});
const parts = (n: number, size = 8 * MiB) =>
  Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, etag: `"e${i + 1}"`, sizeBytes: size }));
const file = (fileName: string, sizeBytes: number, sha: string, extra: Record<string, unknown> = {}) => ({
  fileName, sizeBytes, sha256: H(sha), mimeType: 'application/octet-stream', ...extra,
});
const PARKED = { completingAt: new Date(0) };
const RELEASED = { status: 'UPLOADING', completingAt: null };

describe('safeMimeType', () => {
  it('keeps well-formed types, strips parameters, and neutralises executable ones', () => {
    expect(safeMimeType('application/pdf')).toBe('application/pdf');
    expect(safeMimeType('Image/PNG; charset=binary')).toBe('image/png');
    expect(safeMimeType('text/html')).toBe('application/octet-stream');
    expect(safeMimeType('image/svg+xml')).toBe('application/octet-stream');
    expect(safeMimeType('')).toBe('application/octet-stream');
    expect(safeMimeType('text/plain\r\nX-Evil: 1')).toBe('application/octet-stream');
  });
});

describe('DatabankUploadService.init', () => {
  it('authorizes first, then falls back to the proxy path in dev storage modes', async () => {
    const { svc, storage, databank } = harness();
    storage.supportsDirectUpload = false;
    expect(await svc.init({ clientId: 'c1', files: [] } as never, USER)).toEqual({ mode: 'proxy' });
    expect(databank.resolveWriteScope).toHaveBeenCalled();
  });

  it('resolves each file in order: resume → already-uploaded → duplicate → possible-duplicate → rejected → new', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.findMany.mockResolvedValueOnce([session()]);
    storage.listAllParts.mockResolvedValueOnce(parts(2)); // parts 1-2 already in R2
    prisma.databankFile.findMany
      .mockResolvedValueOnce([{ id: 'fb', fileName: 'same.pdf', folderId: null, createdAt: new Date(), sha256: H('b'), folder: null }])
      .mockResolvedValueOnce([{ id: 'fc', fileName: 'old.pdf', folderId: null, createdAt: new Date(), fileSizeBytes: 1000n, folder: null }]);

    const res = await svc.init(
      {
        clientId: 'c1',
        files: [
          file('big.zip', 40 * MiB, 'a'), // 0 resume
          file('same.pdf', 500, 'b'), // 1 already-uploaded
          file('copy.pdf', 500, 'b'), // 2 duplicate
          file('copy2.pdf', 500, 'b', { allowDuplicate: true }), // 3 new (duplicate allowed)
          file('old.pdf', 1000, 'c'), // 4 possible-duplicate
          file('virus.exe', 10, 'd'), // 5 rejected (blocked type)
          file('huge.iso', 51 * GiB, 'e'), // 6 rejected (over cap)
          file('lost.pdf', 10, 'f', { folderId: '11111111-1111-4111-8111-111111111111' }), // 7 rejected (folder gone)
          file('video.mp4', 100 * MiB, '9'), // 8 new multipart
        ],
      } as never,
      USER,
    );

    if (res.mode !== 'direct') throw new Error('expected direct mode');
    expect(res.results.map((r) => r.status)).toEqual([
      'upload', 'already-uploaded', 'duplicate', 'upload', 'possible-duplicate', 'rejected', 'rejected', 'rejected', 'upload',
    ]);
    const resumed = res.results[0] as Extract<(typeof res.results)[number], { status: 'upload' }>;
    expect(resumed).toMatchObject({ uploadId: 's1', resumed: true, doneParts: [1, 2], partCount: 5 });
    expect(resumed.urls.map((u) => u.partNumber)).toEqual([3, 4, 5]);
    expect(res.results[2]).toMatchObject({ existing: { id: 'fb', fileName: 'same.pdf' } });
    expect(res.results[4]).toMatchObject({ existing: { id: 'fc' } });

    expect(prisma.databankUpload.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.databankUpload.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { fileName: string }) => r.fileName)).toEqual(['copy2.pdf', 'video.mp4']);
    expect(rows[0]).toMatchObject({ strategy: 'SINGLE', sizeBytes: 500n, r2UploadId: null });
    expect(rows[1]).toMatchObject({ strategy: 'MULTIPART', sizeBytes: BigInt(100 * MiB), partSize: 8 * MiB, partCount: 13 });
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);

    const video = res.results[8] as Extract<(typeof res.results)[number], { status: 'upload' }>;
    expect(video.urls.map((u) => u.partNumber)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(video.urlsExpireAt.getTime()).toBeLessThan(video.sessionExpiresAt.getTime());
  });

  it('[review] reports a file whose completion is already running as in-progress, not a new upload', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.findMany.mockResolvedValueOnce([session({ status: 'COMPLETING' })]);
    const res = await svc.init({ clientId: 'c1', files: [file('big.zip', 40 * MiB, 'a')] } as never, USER);
    expect(res.mode === 'direct' && res.results[0]).toEqual({ index: 0, status: 'in-progress', uploadId: 's1' });
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(prisma.databankUpload.createMany).not.toHaveBeenCalled();
  });

  it('[review] rejects the same file twice in one batch instead of opening two sessions', async () => {
    const { svc, prisma } = harness();
    const res = await svc.init({ clientId: 'c1', files: [file('a.pdf', 10, 'a'), file('a.pdf', 10, 'a')] } as never, USER);
    expect(res.mode === 'direct' && res.results.map((r) => r.status)).toEqual(['upload', 'rejected']);
    expect(prisma.databankUpload.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('[review] when R2 lost the multipart upload but the OBJECT is complete, PARKS it (never retires / leaves it UPLOADING)', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.findMany.mockResolvedValueOnce([session()]);
    storage.listAllParts.mockRejectedValueOnce(nosuch());
    storage.headObjectStrict.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    const res = await svc.init({ clientId: 'c1', files: [file('big.zip', 40 * MiB, 'a')] } as never, USER);
    expect(res.mode === 'direct' && res.results[0]).toEqual({ index: 0, status: 'in-progress', uploadId: 's1' });
    expect(prisma.databankUpload.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', status: 'UPLOADING' },
      data: { status: 'COMPLETING', completingAt: new Date(0) },
    });
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('[review] matches a COMPLETING session even past its resume deadline (no second upload)', async () => {
    const { svc, prisma } = harness();
    await svc.init({ clientId: 'c1', files: [file('big.zip', 40 * MiB, 'a')] } as never, USER);
    const where = prisma.databankUpload.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { status: 'UPLOADING', expiresAt: { gt: expect.any(Date) } },
      { status: 'COMPLETING' },
    ]);
  });

  it('starts over when R2 has truly lost a session (404) — retiring it only if still UPLOADING', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.findMany.mockResolvedValueOnce([session()]);
    storage.listAllParts.mockRejectedValueOnce(nosuch());
    const res = await svc.init({ clientId: 'c1', files: [file('big.zip', 40 * MiB, 'a')] } as never, USER);
    expect(prisma.databankUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', status: 'UPLOADING' }, data: expect.objectContaining({ status: 'ABORTED' }) }),
    );
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(res.mode === 'direct' && res.results[0]).toMatchObject({ status: 'upload', resumed: false });
  });

  it('[review] follows a concurrent complete instead of starting over when the retire loses the race', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.findMany.mockResolvedValueOnce([session()]);
    storage.listAllParts.mockRejectedValueOnce(nosuch());
    prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 }); // someone else moved it
    const res = await svc.init({ clientId: 'c1', files: [file('big.zip', 40 * MiB, 'a')] } as never, USER);
    expect(res.mode === 'direct' && res.results[0]).toEqual({ index: 0, status: 'in-progress', uploadId: 's1' });
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('[review] a storage error for ONE file fails only that file, not the whole batch', async () => {
    const { svc, prisma, storage } = harness();
    storage.createMultipartUpload.mockRejectedValueOnce(new Error('500 from storage'));
    const res = await svc.init(
      { clientId: 'c1', files: [file('v.mp4', 100 * MiB, 'a'), file('small.pdf', 10, 'b')] } as never,
      USER,
    );
    expect(res.mode === 'direct' && res.results.map((r) => r.status)).toEqual(['retry', 'upload']);
    expect(prisma.databankUpload.createMany.mock.calls[0][0].data.map((r: { fileName: string }) => r.fileName)).toEqual([
      'small.pdf',
    ]);
  });

  it('[review] never stores an executable content type as declared', async () => {
    const { svc, prisma } = harness();
    await svc.init({ clientId: 'c1', files: [file('page.html', 10, 'a', { mimeType: 'text/html' })] } as never, USER);
    expect(prisma.databankUpload.createMany.mock.calls[0][0].data[0].mimeType).toBe('application/octet-stream');
  });

  it('aborts freshly created R2 uploads if recording the sessions fails', async () => {
    const { svc, prisma, storage } = harness();
    prisma.databankUpload.createMany.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.init({ clientId: 'c1', files: [file('v.mp4', 100 * MiB, 'a')] } as never, USER)).rejects.toThrow('db down');
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(expect.any(String), 'r2-new');
  });
});

describe('DatabankUploadService.complete / finalize', () => {
  const complete = (h: ReturnType<typeof harness>, s = session()) => {
    h.prisma.databankUpload.findMany.mockResolvedValueOnce([s]);
    return h.svc.complete({ ids: [s.id] } as never, USER).then((r) => r.results[0]);
  };
  const lastUpdateData = (h: ReturnType<typeof harness>) =>
    h.prisma.databankUpload.updateMany.mock.calls[h.prisma.databankUpload.updateMany.mock.calls.length - 1][0].data;

  it('verifies every part, completes with ListParts ETags, then records the file under a guarded claim', async () => {
    const h = harness();
    h.storage.headObjectStrict
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.storage.listAllParts.mockResolvedValueOnce(parts(5).reverse());
    const res = await complete(h);
    expect(res).toMatchObject({ status: 'completed', file: { id: 'new-file' } });
    expect(h.storage.completeMultipartUpload).toHaveBeenCalledWith('databank/clients/c1/k.zip', 'r2-up', [
      { partNumber: 1, etag: '"e1"' }, { partNumber: 2, etag: '"e2"' }, { partNumber: 3, etag: '"e3"' },
      { partNumber: 4, etag: '"e4"' }, { partNumber: 5, etag: '"e5"' },
    ]);
    // The session flips to COMPLETED only while OUR claim still stands.
    const commitWhere = h.prisma.databankUpload.updateMany.mock.calls[1][0].where;
    expect(commitWhere).toMatchObject({ id: 's1', status: 'COMPLETING' });
    expect(commitWhere.completingAt).toBeInstanceOf(Date);
    expect(h.prisma.databankFile.create.mock.calls[0][0].data).toMatchObject({
      fileSizeBytes: BigInt(40 * MiB), sha256: H('a'), uploadSessionId: 's1', source: 'UPLOAD', folderId: null,
    });
  });

  it('recovers a complete that died after R2 finished (HEAD-first → straight to commit)', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    expect((await complete(h)).status).toBe('completed');
    expect(h.storage.listAllParts).not.toHaveBeenCalled();
    expect(h.storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('reports missing parts and hands the session back to UPLOADING', async () => {
    const h = harness();
    h.storage.listAllParts.mockResolvedValueOnce(parts(5).filter((p) => p.partNumber !== 3));
    expect(await complete(h)).toEqual({ id: 's1', status: 'missing-parts', missingParts: [3] });
    expect(lastUpdateData(h)).toEqual(RELEASED);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('[review] PARKS (never releases) the session when the DB commit fails after R2 assembled the file', async () => {
    const h = harness();
    h.storage.headObjectStrict
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.storage.listAllParts.mockResolvedValueOnce(parts(5));
    h.prisma.$transaction.mockRejectedValueOnce(new Error('P2028 pool timeout'));
    const res = await complete(h);
    expect(res).toMatchObject({ status: 'retry' });
    expect(lastUpdateData(h)).toEqual(PARKED); // still COMPLETING, reclaimable at once
    expect(h.prisma.databankUpload.updateMany.mock.calls.some((c: any[]) => c[0].data.status === 'UPLOADING')).toBe(false);
  });

  it('[review] a transient HEAD error — e.g. on a takeover of a parked session — PARKS it: never "gone", never back to UPLOADING', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockRejectedValueOnce(new Error('503 from storage'));
    const res = await complete(h, session({ status: 'COMPLETING', completingAt: new Date(0) }));
    expect(res).toMatchObject({ status: 'retry' });
    expect(lastUpdateData(h)).toEqual(PARKED);
    const statuses = h.prisma.databankUpload.updateMany.mock.calls.map((c: any[]) => c[0].data.status);
    expect(statuses).not.toContain('UPLOADING');
    expect(statuses).not.toContain('ABORTED');
  });

  it('[review] NoSuchUpload + the object present = a racing finalize completed it → commit, not "expired"', async () => {
    const h = harness();
    h.storage.headObjectStrict
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.storage.listAllParts.mockRejectedValueOnce(nosuch());
    expect((await complete(h)).status).toBe('completed');
  });

  it('[review] backs off (reports the settled state) when its claim was taken over before commit', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.prisma.databankUpload.updateMany
      .mockResolvedValueOnce({ count: 1 }) // our claim
      .mockResolvedValueOnce({ count: 0 }); // commit guard: claim no longer ours
    h.prisma.databankUpload.findUnique.mockResolvedValueOnce(session({ status: 'COMPLETING' }));
    expect(await complete(h)).toEqual({ id: 's1', status: 'in-progress' });
    expect(h.prisma.databankFile.create).not.toHaveBeenCalled();
  });

  it('treats NoSuchUpload on Complete as "maybe a racing finalize won" and lets HEAD decide', async () => {
    const h = harness();
    h.storage.headObjectStrict
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.storage.listAllParts.mockResolvedValueOnce(parts(5));
    h.storage.completeMultipartUpload.mockRejectedValueOnce(nosuch());
    expect((await complete(h)).status).toBe('completed');
  });

  it('deletes and FAILS an object whose size is not exactly the declared file', async () => {
    const h = harness();
    h.storage.headObjectStrict
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB - 1 });
    h.storage.listAllParts.mockResolvedValueOnce(parts(5));
    expect((await complete(h)).status).toBe('failed');
    expect(h.storage.delete).toHaveBeenCalledWith('databank/clients/c1/k.zip');
    expect(h.prisma.databankFile.create).not.toHaveBeenCalled();
  });

  it('[review] never deletes a mismatched object that a file row references', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValueOnce({ exists: true, sizeBytes: 1 });
    h.prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'someone-elses-row' });
    expect((await complete(h)).status).toBe('failed');
    expect(h.storage.delete).not.toHaveBeenCalled();
    expect(lastUpdateData(h)).toMatchObject({ status: 'FAILED' });
    expect(lastUpdateData(h)).not.toHaveProperty('r2CleanedAt');
  });

  it('returns the winning row when a racing finalizer already recorded the file (P2002)', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    h.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    h.prisma.databankFile.findUnique.mockResolvedValueOnce({ id: 'winner' });
    expect(await complete(h)).toMatchObject({ status: 'completed', file: { id: 'winner' } });
  });

  it('[review] a user who lost access cannot finish it, but the authorised upload is PARKED for the sweeper — never deleted', async () => {
    const h = harness();
    h.databank.resolveWriteScope.mockRejectedValueOnce(new ForbiddenException('nope'));
    const res = await complete(h);
    expect(res).toMatchObject({ status: 'failed', reason: expect.stringMatching(/still be saved/) });
    expect(lastUpdateData(h)).toEqual(PARKED);
    expect(h.storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it('[review] a permanent commit error (destination deleted, P2003) is terminal: FAILED + storage freed, not retried forever', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValue({ exists: true, sizeBytes: 40 * MiB });
    h.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: '5.22.0' }),
    );
    const res = await complete(h);
    expect(res).toMatchObject({ status: 'failed' });
    expect(h.prisma.databankUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(h.storage.delete).toHaveBeenCalledWith('databank/clients/c1/k.zip');
  });

  it('[review] points at an identical file another session already recorded instead of creating a duplicate row', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValue({ exists: true, sizeBytes: 40 * MiB });
    h.prisma.databankFile.findFirst.mockResolvedValueOnce({ id: 'twin-file' }); // twin lookup inside the commit
    const res = await complete(h);
    expect(res).toMatchObject({ status: 'completed', file: { id: 'twin-file' } });
    expect(h.prisma.databankFile.create).not.toHaveBeenCalled();
    expect(h.prisma.databankUpload.updateMany.mock.calls[1][0].data).toMatchObject({ status: 'COMPLETED', fileId: 'twin-file' });
    expect(h.storage.delete).toHaveBeenCalledWith('databank/clients/c1/k.zip'); // our redundant copy freed
  });

  it('[review] checks access once per scope for a whole batch', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValue({ exists: true, sizeBytes: 40 * MiB });
    h.prisma.databankUpload.findMany.mockResolvedValueOnce([session({ id: 's1' }), session({ id: 's2' }), session({ id: 's3' })]);
    const { results } = await h.svc.complete({ ids: ['s1', 's2', 's3'] } as never, USER);
    expect(results.map((r) => r.status)).toEqual(['completed', 'completed', 'completed']);
    expect(h.databank.resolveWriteScope).toHaveBeenCalledTimes(1);
  });

  it('files the upload at the root (relocated) when its folder was deleted mid-upload', async () => {
    const h = harness();
    h.prisma.databankFolder.findFirst.mockResolvedValueOnce(null);
    h.storage.headObjectStrict.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    const res = await complete(h, session({ folderId: 'deleted-folder' }));
    expect(res).toMatchObject({ status: 'completed', relocated: true });
    expect(h.prisma.databankFile.create.mock.calls[0][0].data.folderId).toBeNull();
  });

  it('does not double-finish: a lost claim reports the settled state', async () => {
    const h = harness();
    h.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    h.prisma.databankUpload.findUnique.mockResolvedValueOnce(session({ status: 'COMPLETED', fileId: 'f9' }));
    h.prisma.databankFile.findUnique.mockResolvedValueOnce({ id: 'f9' });
    expect(await complete(h)).toMatchObject({ status: 'completed', file: { id: 'f9' } });

    const h2 = harness();
    h2.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    h2.prisma.databankUpload.findUnique.mockResolvedValueOnce(session({ status: 'COMPLETING' }));
    expect(await complete(h2)).toEqual({ id: 's1', status: 'in-progress' });
    expect(h2.storage.headObjectStrict).not.toHaveBeenCalled();
  });

  it('claims atomically: only UPLOADING, or a COMPLETING claim older than 15 minutes (incl. parked)', async () => {
    const h = harness();
    h.storage.headObjectStrict.mockResolvedValueOnce({ exists: true, sizeBytes: 40 * MiB });
    await complete(h);
    const where = h.prisma.databankUpload.updateMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ status: 'UPLOADING' });
    expect(where.OR[1].status).toBe('COMPLETING');
    const cutoff = where.OR[1].completingAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
    expect(PARKED.completingAt.getTime()).toBeLessThan(cutoff); // a parked claim is reclaimable at once
  });

  it('parks (never hands back) on an unexpected storage error — only proof of "not assembled" releases', async () => {
    const h = harness();
    h.storage.listAllParts.mockRejectedValueOnce(new Error('503 from storage'));
    expect(await complete(h)).toMatchObject({ status: 'retry' });
    expect(lastUpdateData(h)).toEqual(PARKED);
  });

  it('marks an upload R2 no longer has (and no object, confirmed by a 404) as expired', async () => {
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

describe('DatabankUploadService.abort / cleanupStorage', () => {
  it('cancels an in-progress upload and frees its R2 parts', async () => {
    const h = harness();
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ status: 'ABORTED' }));
    expect(await h.svc.abort('s1', USER)).toEqual({ id: 's1', status: 'aborted' });
    expect(h.storage.abortMultipartUpload).toHaveBeenCalledWith('databank/clients/c1/k.zip', 'r2-up');
  });

  it('[review] can discard a PARKED completion (stale claim) — no session is ever stuck without a way out', async () => {
    const h = harness();
    h.prisma.databankUpload.findFirst.mockResolvedValueOnce(session({ status: 'ABORTED' }));
    await h.svc.abort('s1', USER);
    const where = h.prisma.databankUpload.updateMany.mock.calls[0][0].where;
    expect(where.OR[1]).toMatchObject({ status: 'COMPLETING', completingAt: { lt: expect.any(Date) } });
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

  it('[review] leaves a just-cancelled single-PUT uncleaned while its URL could still land a PUT', async () => {
    const h = harness();
    const s = session({ strategy: 'SINGLE', r2UploadId: null, status: 'ABORTED', updatedAt: new Date() });
    await h.svc.cleanupStorage(s as never);
    expect(h.prisma.databankUpload.updateMany).not.toHaveBeenCalled(); // r2CleanedAt NOT stamped

    const h2 = harness(); // once every URL has expired, a 404 is final
    await h2.svc.cleanupStorage(session({ strategy: 'SINGLE', r2UploadId: null, status: 'ABORTED' }) as never);
    expect(h2.prisma.databankUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { r2CleanedAt: expect.any(Date) } }),
    );
  });
});

describe('DatabankUploadService.signParts / listOpen', () => {
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

  it('[review] tells the banner when there are more unfinished uploads than it shows', async () => {
    const h = harness();
    h.prisma.databankUpload.findMany.mockResolvedValueOnce(Array.from({ length: 201 }, (_, i) => ({ id: `s${i}` })));
    const res = await h.svc.listOpen(USER);
    expect(res.uploads).toHaveLength(200);
    expect(res.hasMore).toBe(true);
  });
});
