import { DatabankDepartment } from '@prisma/client';
import { DatabankService } from './databank.service';

/**
 * Databank client lists hide clients that have NO files by default (auto-created
 * / empty client records were cluttering the "My clients" view), while a search
 * still surfaces any client so an officer can open it and upload its first file.
 * Prisma is a mock; no DB.
 */

const USER = { id: 'off1', permissions: ['processing.case.view_all'] } as never;

const CLIENT = (id: string) => ({ id, referenceCode: `TIS-${id}`, firstName: id.toUpperCase(), lastName: 'Client' });

function listClientsHarness(counts: Record<string, number>) {
  const prisma: any = {
    client: {
      findMany: jest.fn(async () => [CLIENT('c1'), CLIENT('c2')]),
    },
    databankFile: {
      groupBy: jest.fn(async () => Object.entries(counts).map(([clientId, n]) => ({ clientId, _count: { _all: n } }))),
    },
  };
  return new DatabankService(prisma as never, {} as never);
}

function byAssociateHarness(counts: Record<string, number>) {
  const officer = (id: string, first: string) => ({ id, email: `${id}@x`, employee: { firstName: first, lastName: 'Off' } });
  const prisma: any = {
    processingCase: {
      findMany: jest.fn(async () => [
        { assignedOfficerId: 'off1', assignedOfficer: officer('off1', 'One'), client: CLIENT('c1') },
        { assignedOfficerId: 'off1', assignedOfficer: officer('off1', 'One'), client: CLIENT('c2') },
        { assignedOfficerId: 'off2', assignedOfficer: officer('off2', 'Two'), client: CLIENT('c3') },
      ]),
    },
    databankFile: {
      groupBy: jest.fn(async () => Object.entries(counts).map(([clientId, n]) => ({ clientId, _count: { _all: n } }))),
    },
  };
  const svc = new DatabankService(prisma as never, {} as never);
  (svc as any).canViewAll = jest.fn(() => true);
  return svc;
}

describe('Databank — hide empty clients from the default browse', () => {
  it('listClients: default browse returns only clients with files', async () => {
    const svc = listClientsHarness({ c1: 2 }); // c1 has 2 files, c2 has 0
    const out = (await svc.listClients(USER, DatabankDepartment.PROCESSING)) as Array<{ id: string; fileCount: number }>;
    expect(out.map((c) => c.id)).toEqual(['c1']);
    expect(out[0].fileCount).toBe(2);
  });

  it('listClients: a search surfaces empty clients too (so a first file can be added)', async () => {
    const svc = listClientsHarness({ c1: 2 });
    const out = (await svc.listClients(USER, DatabankDepartment.PROCESSING, 'client')) as Array<{ id: string }>;
    expect(out.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('clientsByAssociate: default browse hides file-less clients and drops associates left empty', async () => {
    const svc = byAssociateHarness({ c1: 1 }); // only c1 has a file
    const res = (await svc.clientsByAssociate(USER, DatabankDepartment.PROCESSING)) as { associates: Array<{ officerId: string; clientCount: number; clients: Array<{ id: string }> }> };
    // off1 keeps only c1 (c2 empty → hidden); off2 had only c3 (empty) → dropped entirely.
    expect(res.associates.map((a) => a.officerId)).toEqual(['off1']);
    expect(res.associates[0].clients.map((c) => c.id)).toEqual(['c1']);
    expect(res.associates[0].clientCount).toBe(1);
  });

  it('clientsByAssociate: a search shows every matching client, empty or not', async () => {
    const svc = byAssociateHarness({ c1: 1 });
    const res = (await svc.clientsByAssociate(USER, DatabankDepartment.PROCESSING, 'client')) as { associates: Array<{ officerId: string; clients: Array<{ id: string }> }> };
    const ids = res.associates.flatMap((a) => a.clients.map((c) => c.id)).sort();
    expect(ids).toEqual(['c1', 'c2', 'c3']);
  });
});
