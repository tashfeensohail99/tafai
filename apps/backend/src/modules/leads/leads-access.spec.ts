import { NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import type { RequestUser } from '../../common/types/auth.types';

/**
 * Security regression tests for lead WRITE ownership scoping.
 *
 * The rule: a salesperson may only write/convert/assign/delete their OWN
 * assigned (or self-created) leads; an admin/manager with `leads.view_all`
 * may act on any lead. Reads and writes share the same rule. These tests pin
 * that down so it can't silently regress (it was previously enforced only by
 * the controller permission, letting an agent edit any lead by id).
 */

function makePrisma() {
  return {
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

// Only prisma is exercised on the deny paths (the guard throws before any
// other dependency is touched), so the rest are inert mocks.
function makeService(prisma: ReturnType<typeof makePrisma>): LeadsService {
  return new LeadsService(
    prisma as never,
    { log: jest.fn() } as never,
    { record: jest.fn() } as never,
    {} as never,
    {} as never,
    { create: jest.fn() } as never,
  );
}

const ADMIN = {
  id: 'admin-1',
  email: 'admin@example.com',
  roles: ['admin'],
  permissions: ['leads.view_all', 'leads.update', 'leads.delete', 'leads.assign', 'leads.convert'],
} as unknown as RequestUser;

const AGENT = {
  id: 'agent-1',
  email: 'agent@example.com',
  roles: ['sales'],
  permissions: ['leads.view_assigned', 'leads.update', 'leads.convert', 'leads.assign', 'leads.delete'],
} as unknown as RequestUser;

const OWNED_OR = [
  { assignedEmployee: { userId: AGENT.id } },
  { createdByUserId: AGENT.id },
];

describe('LeadsService — lead write ownership scoping', () => {
  describe('assertLeadAccess', () => {
    it('lets an admin (leads.view_all) through with no ownership OR filter', async () => {
      const prisma = makePrisma();
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      const svc = makeService(prisma);
      await expect(svc.assertLeadAccess('lead-1', ADMIN)).resolves.toBeUndefined();
      const where = prisma.lead.findFirst.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.OR).toBeUndefined();
    });

    it('lets an agent through for a lead they own, using the scoped query', async () => {
      const prisma = makePrisma();
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      const svc = makeService(prisma);
      await expect(svc.assertLeadAccess('lead-1', AGENT)).resolves.toBeUndefined();
      const where = prisma.lead.findFirst.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.OR).toEqual(OWNED_OR);
    });

    it('throws 404 for an agent acting on a lead they do not own', async () => {
      const prisma = makePrisma();
      prisma.lead.findFirst.mockResolvedValue(null);
      const svc = makeService(prisma);
      await expect(svc.assertLeadAccess('someone-elses-lead', AGENT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('write entry-points refuse a non-owner before mutating anything', () => {
    it('update() blocks and never writes', async () => {
      const prisma = makePrisma();
      prisma.lead.findFirst.mockResolvedValue(null);
      const svc = makeService(prisma);
      await expect(svc.update('other-lead', { status: 'CONTACTED' } as never, AGENT)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.lead.update).not.toHaveBeenCalled();
      expect(prisma.lead.findUnique).not.toHaveBeenCalled();
    });

    it('assign() blocks and never writes', async () => {
      const prisma = makePrisma();
      prisma.lead.findFirst.mockResolvedValue(null);
      const svc = makeService(prisma);
      await expect(svc.assign('other-lead', { assignedEmployeeId: 'emp-9' } as never, AGENT)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('remove() blocks and never writes', async () => {
      const prisma = makePrisma();
      prisma.lead.findFirst.mockResolvedValue(null);
      const svc = makeService(prisma);
      await expect(svc.remove('other-lead', AGENT)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });
  });

  describe('removeBulk() scopes to the caller', () => {
    it('scopes a non-admin to their own leads', async () => {
      const prisma = makePrisma();
      prisma.lead.findMany.mockResolvedValue([]);
      const svc = makeService(prisma);
      const res = await svc.removeBulk(['a', 'b'], AGENT);
      expect(res).toEqual({ deleted: 0 });
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(OWNED_OR);
      expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT scope an admin (may target any lead)', async () => {
      const prisma = makePrisma();
      prisma.lead.findMany.mockResolvedValue([]);
      const svc = makeService(prisma);
      await svc.removeBulk(['a'], ADMIN);
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });
  });
});
