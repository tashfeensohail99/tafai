import { DatabankDepartment } from '@prisma/client';
import { DatabankController } from './databank.controller';
import { JrDatabankController } from './jr-databank.controller';
import { DatabankService } from './databank.service';

/**
 * Processing/JR databank separation — department STAMPING. Every new databank
 * row is tagged with the CALLING PORTAL's department, hardcoded in the
 * controller and never read from the request. This spec drives each portal's
 * controller end-to-end into a fake prisma and asserts the department that
 * reaches `prisma.databankFolder.create`:
 *   - the Processing controller (@Controller('processing/databank')) → PROCESSING
 *   - the JR controller         (@Controller('jr/databank'))         → JR
 * A JR user therefore cannot create a row tagged PROCESSING (and vice-versa):
 * the tag comes from the route, not the caller's input. Prisma is a mock; no DB.
 */

const USER = { id: 'u1', permissions: ['processing.case.view_all', 'jr.matter.view_all'] } as never;

/** A DatabankService wired to a fake prisma whose folder create records its
 *  data. The pure structure/auth helpers are stubbed (exercised by their own
 *  specs) so only the department tagging is under test. */
function harness() {
  const created: Array<{ data: Record<string, unknown> }> = [];
  const tx = {
    databankFolder: {
      create: jest.fn(async (a: { data: Record<string, unknown> }) => {
        created.push(a);
        return { id: 'new', name: a.data.name, parentFolderId: a.data.parentFolderId ?? null, createdAt: new Date(0), updatedAt: new Date(0) };
      }),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const svc = new DatabankService(prisma as never, {} as never);
  const s = svc as any;
  s.assertClientWriteAccess = jest.fn().mockResolvedValue(undefined);
  s.lockFolderScope = jest.fn().mockResolvedValue(undefined);
  s.assertFolderInScope = jest.fn().mockResolvedValue(null);
  s.uniqueFolderName = jest.fn(async (_scope: unknown, _parent: unknown, name: string) => name);
  const createdDepartment = () => created[0].data.department;
  return { svc, created, createdDepartment };
}

describe('Databank — department is stamped from the calling portal', () => {
  it('the PROCESSING portal controller stamps department: PROCESSING on the new row', async () => {
    const { svc, created, createdDepartment } = harness();
    const controller = new DatabankController(svc, {} as never);
    await controller.createFolder('c1', { name: 'Passport' } as never, USER);
    expect(created).toHaveLength(1);
    expect(createdDepartment()).toBe(DatabankDepartment.PROCESSING);
    expect(createdDepartment()).toBe('PROCESSING');
  });

  it('the JR portal controller stamps department: JR on the new row', async () => {
    const { svc, created, createdDepartment } = harness();
    const controller = new JrDatabankController(svc, {} as never);
    await controller.createFolder('c1', { name: 'Passport' } as never, USER);
    expect(created).toHaveLength(1);
    expect(createdDepartment()).toBe(DatabankDepartment.JR);
    expect(createdDepartment()).toBe('JR');
  });
});
