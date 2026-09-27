import { DatabankUploadSweeperService } from './databank-upload-sweeper.service';

/**
 * Unit tests for the resumable-upload sweeper (Databank Phase 1, PR-5).
 * Prisma, storage and the upload service are mocks; each test sets up the
 * sessions the sweeper would find and asserts what it does with them.
 */

const NOW = new Date('2026-10-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const upload = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  createdByUserId: 'u1',
  clientId: 'c1',
  ownerUserId: null,
  storageKey: 'databank/clients/c1/k.zip',
  strategy: 'MULTIPART',
  r2UploadId: 'r2-1',
  status: 'UPLOADING',
  completingAt: null,
  r2CleanedAt: null,
  expiresAt: new Date(NOW.getTime() - 1000),
  updatedAt: new Date(NOW.getTime() - DAY),
  ...over,
});

const activeUser = {
  id: 'u1',
  email: 'officer@x.com',
  status: 'ACTIVE',
  userRoles: [
    { role: { name: 'processing', rolePermissions: [{ permission: { key: 'processing.document.upload' } }] } },
  ],
};

type Lists = { expired?: unknown[]; parked?: unknown[]; cleanup?: unknown[]; known?: unknown[] };

function harness(lists: Lists = {}) {
  const prisma = {
    databankUpload: {
      findMany: jest.fn(async (args: { where: Record<string, any> }) => {
        const w = args.where;
        if (w.r2UploadId) return lists.known ?? [];
        if (w.status === 'UPLOADING') return lists.expired ?? [];
        if (w.status === 'COMPLETING') return lists.parked ?? [];
        return lists.cleanup ?? [];
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: { findUnique: jest.fn().mockResolvedValue(activeUser) },
  };
  const storage = {
    supportsDirectUpload: true,
    listMultipartUploads: jest.fn().mockResolvedValue([]),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
  };
  const uploads = {
    finalize: jest.fn().mockResolvedValue({ id: 's1', status: 'completed' }),
    cleanupStorage: jest.fn().mockResolvedValue(undefined),
  };
  const sweeper = new DatabankUploadSweeperService(prisma as never, storage as never, uploads as never);
  return { sweeper, prisma, storage, uploads };
}

describe('DatabankUploadSweeperService', () => {
  it('does nothing in dev storage modes (no direct uploads exist there)', async () => {
    const h = harness({ expired: [upload()] });
    h.storage.supportsDirectUpload = false;
    await h.sweeper.sweep(NOW);
    expect(h.prisma.databankUpload.findMany).not.toHaveBeenCalled();
  });

  it('never overlaps a slow pass with the next tick', async () => {
    const h = harness({ expired: [upload()] });
    let release!: () => void;
    h.uploads.finalize.mockImplementationOnce(() => new Promise((r) => (release = () => r({ status: 'completed' }))));
    const first = h.sweeper.sweep(NOW);
    await new Promise((r) => setImmediate(r));
    await h.sweeper.sweep(NOW); // returns at once — the first pass is still running
    expect(h.uploads.finalize).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  describe('expired uploads', () => {
    it('RECORDS an expired upload whose bytes are all in storage (a crashed tab) instead of deleting it', async () => {
      const h = harness({ expired: [upload()] });
      await h.sweeper.sweep(NOW);
      expect(h.uploads.finalize).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1' }),
        expect.objectContaining({ sweeper: true, user: expect.objectContaining({ id: 'u1' }) }),
      );
      expect(h.prisma.databankUpload.updateMany).not.toHaveBeenCalled();
      expect(h.uploads.cleanupStorage).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ABORTED' }));
    });

    it('expires + frees one with genuinely missing parts — via a compare-and-set on UPLOADING', async () => {
      const h = harness({ expired: [upload()] });
      h.uploads.finalize.mockResolvedValueOnce({ id: 's1', status: 'missing-parts', missingParts: [3] });
      await h.sweeper.sweep(NOW);
      expect(h.prisma.databankUpload.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'UPLOADING', expiresAt: { lt: NOW } },
        data: { status: 'ABORTED', failureReason: 'expired', completingAt: null },
      });
      expect(h.uploads.cleanupStorage).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', status: 'ABORTED' }));
    });

    it('leaves it alone when someone else changed it first, or storage was busy', async () => {
      const h = harness({ expired: [upload({ id: 'a' }), upload({ id: 'b' })] });
      h.uploads.finalize
        .mockResolvedValueOnce({ id: 'a', status: 'missing-parts', missingParts: [1] })
        .mockResolvedValueOnce({ id: 'b', status: 'retry', reason: 'busy' });
      h.prisma.databankUpload.updateMany.mockResolvedValueOnce({ count: 0 }); // 'a' was resumed meanwhile
      await h.sweeper.sweep(NOW);
      expect(h.uploads.cleanupStorage).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ABORTED' }));
    });
  });

  describe('parked / dead completions', () => {
    it('finishes COMPLETING claims older than 15 minutes with the creator\'s CURRENT permissions', async () => {
      const h = harness({ parked: [upload({ status: 'COMPLETING', completingAt: new Date(0) })] });
      await h.sweeper.sweep(NOW);
      const where = h.prisma.databankUpload.findMany.mock.calls.find((c: any[]) => c[0].where.status === 'COMPLETING')![0].where;
      expect(where.completingAt.lt.getTime()).toBe(NOW.getTime() - 15 * 60 * 1000);
      expect(h.uploads.finalize).toHaveBeenCalledWith(
        expect.anything(),
        { user: { id: 'u1', email: 'officer@x.com', roles: ['processing'], permissions: ['processing.document.upload'] }, sweeper: true },
      );
    });

    it('treats a creator who is no longer ACTIVE as having no access (finalize then cancels + frees)', async () => {
      const h = harness({ parked: [upload({ status: 'COMPLETING', completingAt: new Date(0) })] });
      h.prisma.userAccount.findUnique.mockResolvedValueOnce({ ...activeUser, status: 'INACTIVE' });
      await h.sweeper.sweep(NOW);
      expect(h.uploads.finalize.mock.calls[0][1].user.permissions).toEqual([]);
    });

    it('treats a deleted creator account the same way', async () => {
      const h = harness({ parked: [upload({ status: 'COMPLETING', completingAt: new Date(0) })] });
      h.prisma.userAccount.findUnique.mockResolvedValueOnce(null);
      await h.sweeper.sweep(NOW);
      expect(h.uploads.finalize.mock.calls[0][1].user).toEqual({ id: 'u1', email: '', roles: [], permissions: [] });
    });

    it('loads each creator once per pass, however many sessions they own', async () => {
      const h = harness({
        expired: [upload({ id: 'a' })],
        parked: [upload({ id: 'b', status: 'COMPLETING' }), upload({ id: 'c', status: 'COMPLETING' })],
      });
      await h.sweeper.sweep(NOW);
      expect(h.uploads.finalize).toHaveBeenCalledTimes(3);
      expect(h.prisma.userAccount.findUnique).toHaveBeenCalledTimes(1);
    });

    it('never lets one failing session stop the pass', async () => {
      const h = harness({ parked: [upload({ id: 'a', status: 'COMPLETING' }), upload({ id: 'b', status: 'COMPLETING' })] });
      h.uploads.finalize.mockRejectedValueOnce(new Error('db down'));
      await expect(h.sweeper.sweep(NOW)).resolves.toBeUndefined();
      expect(h.uploads.finalize).toHaveBeenCalledTimes(2);
    });
  });

  it('retries storage cleanup for ABORTED / FAILED sessions and COMPLETED twins still holding bytes', async () => {
    const pending = [upload({ id: 'x', status: 'ABORTED' }), upload({ id: 'y', status: 'COMPLETED' })];
    const h = harness({ cleanup: pending });
    await h.sweeper.sweep(NOW);
    const where = h.prisma.databankUpload.findMany.mock.calls.find((c: any[]) => c[0].where.r2CleanedAt === null)![0].where;
    expect(where.status.in).toEqual(['ABORTED', 'FAILED', 'COMPLETED']);
    expect(h.uploads.cleanupStorage).toHaveBeenCalledWith(pending[0]);
    expect(h.uploads.cleanupStorage).toHaveBeenCalledWith(pending[1]);
  });

  describe('daily orphan reconcile', () => {
    const r2 = (uploadId: string, ageMs: number) => ({
      key: `databank/clients/c1/${uploadId}.bin`,
      uploadId,
      initiated: new Date(NOW.getTime() - ageMs),
    });

    it('aborts R2 uploads older than 24 h that the DB does not know or gave up on — never live ones or young ones', async () => {
      const h = harness({
        known: [
          { r2UploadId: 'live-up', status: 'UPLOADING' },
          { r2UploadId: 'live-cmp', status: 'COMPLETING' },
          { r2UploadId: 'dead', status: 'ABORTED' },
        ],
      });
      h.storage.listMultipartUploads.mockResolvedValueOnce([
        r2('unknown', 2 * DAY), r2('dead', 2 * DAY), r2('live-up', 2 * DAY), r2('live-cmp', 2 * DAY), r2('young', 1000),
      ]);
      await h.sweeper.sweep(NOW);
      const aborted = h.storage.abortMultipartUpload.mock.calls.map((c: any[]) => c[1]).sort();
      expect(aborted).toEqual(['dead', 'unknown']);
    });

    it('runs at most once a day', async () => {
      const h = harness();
      await h.sweeper.sweep(NOW);
      await h.sweeper.sweep(new Date(NOW.getTime() + 30 * 60 * 1000));
      expect(h.storage.listMultipartUploads).toHaveBeenCalledTimes(1);
      await h.sweeper.sweep(new Date(NOW.getTime() + DAY));
      expect(h.storage.listMultipartUploads).toHaveBeenCalledTimes(2);
    });
  });

  it('respects the kill-switch', () => {
    const h = harness();
    const prev = process.env.DATABANK_UPLOAD_SWEEPER_ENABLED;
    process.env.DATABANK_UPLOAD_SWEEPER_ENABLED = 'false';
    const spy = jest.spyOn(global, 'setInterval');
    try {
      h.sweeper.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.DATABANK_UPLOAD_SWEEPER_ENABLED;
      else process.env.DATABANK_UPLOAD_SWEEPER_ENABLED = prev;
      h.sweeper.onModuleDestroy();
    }
  });
});
