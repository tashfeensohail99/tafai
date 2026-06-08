import { FollowUpsService } from './follow-ups.service';
import type { RequestUser } from '../../common/types/auth.types';

/**
 * Tests for the follow-up list: PKT due-buckets, pagination, and the scope/search
 * combination (a view_assigned agent's search must stay scoped to their own
 * follow-ups — the AND, not a clobbered OR).
 */

function makePrisma(items: unknown[] = [], total = 0) {
  const followUp = {
    findMany: jest.fn().mockResolvedValue(items),
    count: jest.fn().mockResolvedValue(total),
  };
  return {
    followUp,
    // Mirror Prisma's $transaction([p1, p2]) → [r1, r2]
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>): FollowUpsService {
  return new FollowUpsService(prisma as never, { log: jest.fn() } as never, {
    record: jest.fn(),
  } as never);
}

const ADMIN = {
  id: 'admin-1',
  permissions: ['follow_ups.view_all'],
} as unknown as RequestUser;

const AGENT = {
  id: 'agent-1',
  permissions: ['follow_ups.view_assigned'],
} as unknown as RequestUser;

const whereOf = (prisma: ReturnType<typeof makePrisma>) =>
  prisma.followUp.findMany.mock.calls[0][0].where as Record<string, any>;

describe('FollowUpsService.findAllAccessible', () => {
  it('returns { items, total }', async () => {
    const prisma = makePrisma([{ id: 'f1' }], 7);
    const svc = makeService(prisma);
    const res = await svc.findAllAccessible({}, ADMIN);
    expect(res).toEqual({ items: [{ id: 'f1' }], total: 7 });
  });

  describe('buckets (PKT)', () => {
    it('overdue → dueAt before start-of-today, implies OPEN', async () => {
      const prisma = makePrisma();
      await makeService(prisma).findAllAccessible({ bucket: 'overdue' } as never, ADMIN);
      const where = whereOf(prisma);
      expect(where.status).toBe('OPEN');
      expect(where.dueAt.lt).toBeInstanceOf(Date);
      expect(where.dueAt.gte).toBeUndefined();
    });
    it('today → a 24h window [start-of-today, start-of-tomorrow)', async () => {
      const prisma = makePrisma();
      await makeService(prisma).findAllAccessible({ bucket: 'today' } as never, ADMIN);
      const { dueAt } = whereOf(prisma);
      expect(dueAt.gte).toBeInstanceOf(Date);
      expect(dueAt.lt).toBeInstanceOf(Date);
      expect(dueAt.lt.getTime() - dueAt.gte.getTime()).toBe(24 * 60 * 60_000);
    });
    it('upcoming → dueAt at/after start-of-tomorrow', async () => {
      const prisma = makePrisma();
      await makeService(prisma).findAllAccessible({ bucket: 'upcoming' } as never, ADMIN);
      const { dueAt } = whereOf(prisma);
      expect(dueAt.gte).toBeInstanceOf(Date);
      expect(dueAt.lt).toBeUndefined();
    });
  });

  describe('scope + search are AND-combined (no OR clobber)', () => {
    it('keeps the agent ownership scope when searching', async () => {
      const prisma = makePrisma();
      await makeService(prisma).findAllAccessible({ search: 'visa' } as never, AGENT);
      const where = whereOf(prisma);
      expect(Array.isArray(where.AND)).toBe(true);
      expect(where.AND).toHaveLength(2);
      const scope = where.AND.find((c: any) => c.OR?.some((o: any) => 'createdByUserId' in o));
      const search = where.AND.find((c: any) => c.OR?.some((o: any) => 'title' in o));
      expect(scope).toBeTruthy();
      expect(search).toBeTruthy();
    });
    it('admin scope is empty, so AND holds just the search clause', async () => {
      const prisma = makePrisma();
      await makeService(prisma).findAllAccessible({ search: 'visa' } as never, ADMIN);
      const where = whereOf(prisma);
      expect(where.AND[0]).toEqual({}); // view_all → no scope restriction
    });
  });

  describe('pagination', () => {
    it('applies skip/take when page+limit given', async () => {
      const prisma = makePrisma();
      await makeService(prisma).findAllAccessible({ page: 3, limit: 10 } as never, ADMIN);
      const args = prisma.followUp.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });
    it('returns everything (no skip/take) when neither given', async () => {
      const prisma = makePrisma();
      await makeService(prisma).findAllAccessible({}, ADMIN);
      const args = prisma.followUp.findMany.mock.calls[0][0];
      expect(args.skip).toBeUndefined();
      expect(args.take).toBeUndefined();
    });
  });
});
