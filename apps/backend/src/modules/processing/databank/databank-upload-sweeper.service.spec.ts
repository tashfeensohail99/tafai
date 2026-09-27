import { DatabankUploadSweeperService } from './databank-upload-sweeper.service';

/**
 * Unit tests for the resumable-upload sweeper (Databank Phase 1, PR-5).
 * Prisma, storage and the upload service are mocks; each test sets up the
 * sessions the sweeper would find and asserts what it does with them.
 * Tests marked [review] are regressions for the sweeper's adversarial review.
 */

const NOW = new Date('2026-10-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const BUDGET = DatabankUploadSweeperService.PASS_BUDGET_MS;

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
const many = (n: number, prefix: string, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => upload({ id: `${prefix}${String(i).padStart(4, '0')}`, ...over }));

const activeUser = {
  id: 'u1',
  email: 'officer@x.com',
  status: 'ACTIVE',
  userRoles: [
    { role: { name: 'processing', rolePermissions: [{ permission: { key: 'processing.document.upload' } }] } },
  ],
};

type Lists = {
  expired?: unknown[];
  parked?: unknown[];
  cleanup?: unknown[];
  known?: unknown[];
  /** Rows for the SECOND page of a drain (keyset present), by step. */
  next?: { UPLOADING?: unknown[]; COMPLETING?: unknown[]; cleanup?: unknown[] };
};

/** The step filter is where.AND[0]; a keyset page has where.AND[1].OR. */
const stepOf = (w: any) => (w.AND ? w.AND[0] : w);
const isLaterPage = (w: any) => !!(w.AND && w.AND[1] && w.AND[1].OR);

function harness(lists: Lists = {}) {
  const prisma = {
    databankUpload: {
      findMany: jest.fn(async (args: { where: any }) => {
        const w = args.where;
        if (w.r2UploadId) return lists.known ?? [];
        const step = stepOf(w);
        const later = isLaterPage(w);
        if (step.status === 'UPLOADING') return later ? lists.next?.UPLOADING ?? [] : lists.expired ?? [];
        if (step.status === 'COMPLETING') return later ? lists.next?.COMPLETING ?? [] : lists.parked ?? [];
        return later ? lists.next?.cleanup ?? [] : lists.cleanup ?? [];
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userAccount: { findUnique: jest.fn().mockResolvedValue(activeUser) },
  };
  const storage = {
    supportsDirectUpload: true,
    uploadUrlTtlSeconds: 21600,
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

describe('DatabankUploadSweeperService', () => {
  it('does nothing in dev storage modes (no direct uploads exist there)', async () => {
    const h = harness({ expired: [upload()] });
    h.storage.supportsDirectUpload = false;
    await h.sweeper.sweep(NOW);
    expect(h.prisma.databankUpload.findMany).not.toHaveBeenCalled();
  });

  it('never overlaps a live pass with the next tick', async () => {
    const h = harness({ expired: [upload()] });
    let release!: () => void;
    h.uploads.finalize.mockImplementationOnce(() => new Promise((r) => (release = () => r({ status: 'completed' }))));
    const first = h.sweeper.sweep(NOW);
    await new Promise((r) => setImmediate(r));
    await h.sweeper.sweep(NOW); // returns at once — the first pass is still running (well within budget)
    expect(h.uploads.finalize).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('[review] supersedes a pass stuck on a hung storage call (after 2× the budget)', async () => {
    const h = harness({ expired: [upload()] });
    let t = 0;
    h.sweeper.clock = () => t;
    h.uploads.finalize.mockImplementationOnce(() => new Promise(() => undefined)); // never settles
    void h.sweeper.sweep(NOW);
    await new Promise((r) => setImmediate(r));
    t = 2 * BUDGET + 1;
    await h.sweeper.sweep(NOW);
    expect(h.uploads.finalize).toHaveBeenCalledTimes(2);
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

    it('[review] DRAINS the whole backlog in one pass (keyset pages), not one fixed batch', async () => {
      const h = harness({ expired: many(100, 'a'), next: { UPLOADING: many(50, 'b') } });
      await h.sweeper.sweep(NOW);
      expect(h.uploads.finalize).toHaveBeenCalledTimes(150);
      const pages = h.prisma.databankUpload.findMany.mock.calls
        .map((c: any[]) => c[0])
        .filter((a: any) => stepOf(a.where).status === 'UPLOADING');
      expect(pages).toHaveLength(2);
      expect(pages[0].orderBy).toEqual([{ expiresAt: 'asc' }, { id: 'asc' }]);
      // Page 2 continues AFTER the last row of page 1 (each row at most once per pass).
      expect(pages[1].where.AND[1].OR[1]).toEqual({ expiresAt: expect.any(Date), id: { gt: 'a0099' } });
    });

    it('[review] stops at the pass budget and leaves the rest for the next pass', async () => {
      const h = harness({ expired: many(10, 'a') });
      let t = 0;
      h.sweeper.clock = () => t;
      h.uploads.finalize.mockImplementation(async () => {
        t = BUDGET + 1; // the budget runs out while handling the first row
        return { status: 'completed' };
      });
      await h.sweeper.sweep(NOW);
      expect(h.uploads.finalize.mock.calls.length).toBeLessThan(10);
    });
  });

  describe('parked / dead completions', () => {
    it("finishes COMPLETING claims older than 15 minutes, first, with the creator's CURRENT permissions", async () => {
      const h = harness({
        parked: [upload({ status: 'COMPLETING', completingAt: new Date(0) })],
        expired: [upload({ id: 'late' })],
      });
      await h.sweeper.sweep(NOW);
      const step = stepOf(
        h.prisma.databankUpload.findMany.mock.calls.find((c: any[]) => stepOf(c[0].where).status === 'COMPLETING')![0].where,
      );
      expect(step.completingAt.lt.getTime()).toBe(NOW.getTime() - 15 * 60 * 1000);
      expect(h.uploads.finalize.mock.calls[0][0].id).toBe('s1'); // parked before expired
      expect(h.uploads.finalize.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          user: { id: 'u1', email: 'officer@x.com', roles: ['processing'], permissions: ['processing.document.upload'] },
          sweeper: true,
          scopeChecks: expect.any(Map), // [review] per-pass access-check memo
        }),
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

  it('retries storage cleanup for ABORTED / FAILED sessions and COMPLETED twins — skipping single-PUTs still inside their URL window', async () => {
    const pending = [upload({ id: 'x', status: 'ABORTED' }), upload({ id: 'y', status: 'COMPLETED' })];
    const h = harness({ cleanup: pending });
    await h.sweeper.sweep(NOW);
    const step = stepOf(
      h.prisma.databankUpload.findMany.mock.calls.find((c: any[]) => stepOf(c[0].where).r2CleanedAt === null)![0].where,
    );
    expect(step.status.in).toEqual(['ABORTED', 'FAILED', 'COMPLETED']);
    expect(step.NOT).toEqual({ strategy: 'SINGLE', updatedAt: { gt: new Date(NOW.getTime() - 21600 * 1000) } });
    expect(h.uploads.cleanupStorage).toHaveBeenCalledWith(pending[0]);
    expect(h.uploads.cleanupStorage).toHaveBeenCalledWith(pending[1]);
  });

  it('[review] purges settled sessions older than 30 days, once a day', async () => {
    const h = harness();
    await h.sweeper.sweep(NOW);
    expect(h.prisma.databankUpload.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['COMPLETED', 'ABORTED', 'FAILED'] },
        r2CleanedAt: { not: null },
        updatedAt: { lt: new Date(NOW.getTime() - 30 * DAY) },
      },
    });
    await h.sweeper.sweep(new Date(NOW.getTime() + 30 * 60 * 1000));
    expect(h.prisma.databankUpload.deleteMany).toHaveBeenCalledTimes(1);
    await h.sweeper.sweep(new Date(NOW.getTime() + DAY));
    expect(h.prisma.databankUpload.deleteMany).toHaveBeenCalledTimes(2);
  });

  describe('orphan reconcile', () => {
    const r2 = (uploadId: string, ageMs: number) => ({
      key: `databank/clients/c1/${uploadId}.bin`,
      uploadId,
      initiated: new Date(NOW.getTime() - ageMs),
    });

    it('[review] is OFF unless explicitly enabled (it acts on the whole bucket prefix)', async () => {
      await withEnv('DATABANK_UPLOAD_RECONCILE_ENABLED', undefined, async () => {
        const h = harness();
        await h.sweeper.sweep(NOW);
        expect(h.storage.listMultipartUploads).not.toHaveBeenCalled();
      });
    });

    it('when enabled, aborts R2 uploads older than 24 h the DB does not know or gave up on — never live or young ones', async () => {
      await withEnv('DATABANK_UPLOAD_RECONCILE_ENABLED', 'true', async () => {
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
        expect(h.storage.abortMultipartUpload.mock.calls.map((c: any[]) => c[1]).sort()).toEqual(['dead', 'unknown']);
      });
    });
  });

  it('respects the kill-switch', async () => {
    await withEnv('DATABANK_UPLOAD_SWEEPER_ENABLED', 'false', () => {
      const h = harness();
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
});
