/**
 * Unit tests for the JR associate work-report subsystem (§11.7, PR 10A).
 * Prisma is fully mocked (jest.fn) — no real database. Follows the jr spec
 * mocking style (jr-notifications.service.spec.ts).
 *
 * Covers the adversarial-critic corrections:
 *   (1) a REAL JrMatter field change (assignMatter) writes a JrAuditLog row whose
 *       oldValues/newValues carry a DECODABLE delta the compiler then credits —
 *       proving rows carry deltas, not merely that columns exist (correction #4).
 *   (2) subject-override: a non-view_all caller's subjectAssociateId is forced to
 *       self; a view_all caller may pick another subject.
 *   (3) HEAD_ONLY case notes are excluded unless canViewAll.
 *   (4) a zero-activity window yields an empty-but-valid body (never an error).
 */

import { JudicialReviewService } from './judicial-review.service';
import { JrWorkReportCompileService } from './jr-work-report-compile.service';
import { JrWorkReportService } from './jr-work-report.service';

const HEAD = {
  id: 'head-1',
  email: 'head@tashfeengroup.com',
  roles: ['jr_head'],
  permissions: ['jr.report.generate', 'jr.report.view_all', 'jr.matter.view_all'],
};
const ASSOCIATE = {
  id: 'assoc-1',
  email: 'assoc@tashfeengroup.com',
  roles: ['jr_associate'],
  permissions: ['jr.report.generate'],
};

// ---------------------------------------------------------------------------
// Compile-service prisma mock: one jrAuditLog.findMany discriminated by
// where.action (spine call vs assign-union call).
// ---------------------------------------------------------------------------
function buildCompilePrisma(opts: {
  spine?: any[];
  assign?: any[];
  matters?: any[];
  versions?: any[];
  approvals?: number;
  notes?: any[];
  deadlines?: any[];
  clients?: any[];
}) {
  const noteFindMany = jest.fn().mockResolvedValue(opts.notes ?? []);
  return {
    prisma: {
      jrAuditLog: {
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            args?.where?.action === 'matter_assigned'
              ? opts.assign ?? []
              : opts.spine ?? [],
          ),
        ),
      },
      jrMatter: { findMany: jest.fn().mockResolvedValue(opts.matters ?? []) },
      jrArtifactVersion: { findMany: jest.fn().mockResolvedValue(opts.versions ?? []) },
      jrArtifact: { count: jest.fn().mockResolvedValue(opts.approvals ?? 0) },
      jrNote: { findMany: noteFindMany },
      jrDeadline: { findMany: jest.fn().mockResolvedValue(opts.deadlines ?? []) },
      client: { findMany: jest.fn().mockResolvedValue(opts.clients ?? []) },
    },
    noteFindMany,
  };
}

describe('JR work-report subsystem (§11.7, PR 10A)', () => {
  // -------------------------------------------------------------------------
  // (1) decodable audit delta — writer + reader agree end-to-end
  // -------------------------------------------------------------------------
  it('(1) a JrMatter reassignment writes a decodable delta the compiler credits', async () => {
    const auditCreate = jest.fn().mockResolvedValue({});
    const matter = {
      id: 'matter-1',
      matterNumber: 'JR-2026-00001',
      styleOfCause: 'X v MCI',
      assignedAssociateUserId: 'old-user',
    };
    const prisma = {
      jrMatter: { findFirst: jest.fn().mockResolvedValue(matter) },
      userAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'new-user' }) },
      $transaction: jest.fn().mockImplementation((cb: any) =>
        cb({
          jrMatter: {
            update: jest.fn().mockResolvedValue({ ...matter, assignedAssociateUserId: 'new-user' }),
          },
          jrAuditLog: { create: auditCreate },
        }),
      ),
    };
    const notifications = { matterAssigned: jest.fn().mockResolvedValue(undefined) };
    const jr = new JudicialReviewService(prisma as any, {} as any, notifications as any);

    await jr.assignMatter('matter-1', { assignedAssociateUserId: 'new-user' }, HEAD as any);

    // The written row carries a DECODABLE delta (not just non-null columns).
    const row = auditCreate.mock.calls[0][0].data;
    expect(row.action).toBe('matter_assigned');
    expect(row.oldValues.assignedAssociateUserId).toBe('old-user');
    expect(row.newValues.assignedAssociateUserId).toBe('new-user');
    expect(row.oldValues.assignedAssociateUserId).not.toBe(row.newValues.assignedAssociateUserId);

    // The compiler decodes THAT SAME row and credits the matter to the new subject,
    // even though the spine (the subject's own actions) is empty.
    const { prisma: compilePrisma } = buildCompilePrisma({
      spine: [],
      assign: [{ matterId: 'matter-1', oldValues: row.oldValues, newValues: row.newValues }],
      matters: [
        {
          id: 'matter-1',
          matterNumber: 'JR-2026-00001',
          styleOfCause: 'X v MCI',
          stage: 'RETAINED',
          clientId: 'client-1',
          applicationAllowed: null,
          redeterminationApproved: null,
          closeReason: null,
        },
      ],
      clients: [{ id: 'client-1', firstName: 'Ada', lastName: 'Lovelace', referenceCode: 'C-1' }],
    });
    const compiler = new JrWorkReportCompileService(compilePrisma as any);

    const body = await compiler.compileBody({
      subjectAssociateUserId: 'new-user',
      periodFrom: new Date('2026-08-01T00:00:00Z'),
      periodTo: new Date('2026-08-31T23:59:59Z'),
      canViewAll: false,
    });

    expect(body.summary.matterCount).toBe(1);
    expect(body.matters[0].matterId).toBe('matter-1');
    expect(body.matters[0].clientName).toBe('Ada Lovelace');
    expect(body.hasActivity).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (2) subject override
  // -------------------------------------------------------------------------
  it('(2) forces a non-view_all caller subject to self, but lets a Head pick another', async () => {
    function buildReportService() {
      const create = jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          id: 'r-1',
          status: 'DRAFT',
          canViewAllAtCompile: args.data.canViewAllAtCompile,
          periodFrom: new Date('2026-08-01T00:00:00Z'),
          periodTo: new Date('2026-08-31T00:00:00Z'),
          createdByUserId: args.data.createdByUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
          frozenPdfKey: null,
          frozenPdfSha256: null,
          subjectAssociateUserId: args.data.subjectAssociateUserId,
        }),
      );
      const prisma = {
        jrWorkReport: { findFirst: jest.fn().mockResolvedValue(null), create },
        jrWorkReportNote: { findMany: jest.fn().mockResolvedValue([]) },
        jrWorkReportAttachment: { findMany: jest.fn().mockResolvedValue([]) },
        userAccount: {
          findUnique: jest.fn().mockResolvedValue({
            email: 'x@tashfeengroup.com',
            employee: { firstName: 'X', lastName: 'Y' },
          }),
        },
      };
      const compiler = { compileBody: jest.fn().mockResolvedValue({ hasActivity: false }) };
      const storage = {} as any;
      const openai = {} as any;
      const pdf = {} as any;
      const email = {} as any;
      const service = new JrWorkReportService(
        prisma as any,
        compiler as any,
        storage,
        openai,
        pdf,
        email,
      );
      return { service, create };
    }

    // Associate supplies someone ELSE's id → actively overridden to self.
    const a = buildReportService();
    await a.service.create(
      { subjectAssociateId: 'victim-9', periodFrom: '2026-08-01', periodTo: '2026-08-31' },
      ASSOCIATE as any,
    );
    expect(a.create.mock.calls[0][0].data.subjectAssociateUserId).toBe('assoc-1');
    expect(a.create.mock.calls[0][0].data.canViewAllAtCompile).toBe(false);

    // Head (view_all) may pick another subject.
    const h = buildReportService();
    await h.service.create(
      { subjectAssociateId: 'assoc-1', periodFrom: '2026-08-01', periodTo: '2026-08-31' },
      HEAD as any,
    );
    expect(h.create.mock.calls[0][0].data.subjectAssociateUserId).toBe('assoc-1');
    expect(h.create.mock.calls[0][0].data.canViewAllAtCompile).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (3) HEAD_ONLY note exclusion
  // -------------------------------------------------------------------------
  it('(3) excludes HEAD_ONLY case notes unless canViewAll', async () => {
    const excluded = buildCompilePrisma({});
    const compilerA = new JrWorkReportCompileService(excluded.prisma as any);
    await compilerA.compileBody({
      subjectAssociateUserId: 'assoc-1',
      periodFrom: new Date('2026-08-01T00:00:00Z'),
      periodTo: new Date('2026-08-31T23:59:59Z'),
      canViewAll: false,
    });
    expect(excluded.noteFindMany.mock.calls[0][0].where.noteType).toEqual({ not: 'HEAD_ONLY' });

    const included = buildCompilePrisma({});
    const compilerB = new JrWorkReportCompileService(included.prisma as any);
    await compilerB.compileBody({
      subjectAssociateUserId: 'assoc-1',
      periodFrom: new Date('2026-08-01T00:00:00Z'),
      periodTo: new Date('2026-08-31T23:59:59Z'),
      canViewAll: true,
    });
    expect(included.noteFindMany.mock.calls[0][0].where.noteType).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // (4) zero-activity window → empty-but-valid body
  // -------------------------------------------------------------------------
  it('(4) a zero-activity window yields an empty-but-valid body (not an error)', async () => {
    const { prisma } = buildCompilePrisma({});
    const compiler = new JrWorkReportCompileService(prisma as any);

    const body = await compiler.compileBody({
      subjectAssociateUserId: 'assoc-1',
      periodFrom: new Date('2026-08-01T00:00:00Z'),
      periodTo: new Date('2026-08-31T23:59:59Z'),
      canViewAll: false,
    });

    expect(body.hasActivity).toBe(false);
    expect(body.matters).toEqual([]);
    expect(body.summary.matterCount).toBe(0);
    expect(body.summary.draftVersions).toBe(0);
    expect(body.summary.wins).toBe(0);
    expect(body.deadlines.total).toBe(0);
    expect(body.deadlines.scope).toBe('matter-level');
    // No caseload → no per-matter / deadline / client fan-out.
    expect((prisma.jrMatter.findMany as jest.Mock)).not.toHaveBeenCalled();
    expect((prisma.jrDeadline.findMany as jest.Mock)).not.toHaveBeenCalled();
    expect((prisma.client.findMany as jest.Mock)).not.toHaveBeenCalled();
  });
});
