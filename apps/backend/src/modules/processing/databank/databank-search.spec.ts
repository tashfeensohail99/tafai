import { BadRequestException } from '@nestjs/common';
import { DatabankDepartment } from '@prisma/client';
import { DatabankService } from './databank.service';

/**
 * Databank P2 search (full-text + fuzzy, server-paginated) and the file-update
 * method's new description/tags handling. Prisma is a mock whose `$queryRaw`
 * returns canned rows and inspects the tagged-template `Prisma.Sql` it was
 * handed — so we can prove the query is PARAMETERIZED (q never concatenated) and
 * that scope access checks run BEFORE any query. No DB.
 */

const USER = { id: 'u1', permissions: ['processing.case.view_all'] } as never;

const FACET = { image: 2, pdf: 3, video: 0, audio: 0, office: 1, other: 4, total: 10 };
const ROW = {
  id: 'file-1',
  folderId: null,
  fileName: 'passport.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: BigInt(10),
  description: null,
  tags: [],
  source: 'UPLOAD',
  uploadedByUserId: 'u1',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** The facet query is the one carrying COUNT(*) FILTER; the other is results. */
const isFacet = (q: any) => String(q.sql).includes('FILTER');

function harness() {
  const calls: any[] = [];
  const prisma = {
    $queryRaw: jest.fn(async (q: any) => {
      calls.push(q);
      return isFacet(q) ? [FACET] : [ROW];
    }),
  };
  const svc = new DatabankService(prisma as never, {} as never);
  const s = svc as any;
  s.assertClientReadAccess = jest.fn().mockResolvedValue(undefined);
  s.assertPersonalAccess = jest.fn();
  const resultsQ = () => calls.find((c) => !isFacet(c));
  const facetQ = () => calls.find(isFacet);
  return { svc, prisma, calls, s, resultsQ, facetQ };
}

describe('DatabankService.searchDatabank', () => {
  it('client scope: authorizes via assertClientReadAccess and returns the paginated shape', async () => {
    const { svc, s, prisma } = harness();
    const out = await svc.searchDatabank(USER, { clientId: 'c1', q: 'passport' }, DatabankDepartment.PROCESSING);

    expect(s.assertClientReadAccess).toHaveBeenCalledWith('c1', USER);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // results + facets
    expect(out).toMatchObject({
      results: [ROW],
      total: 10, // no type filter → the whole scope+q set
      page: 1,
      pageSize: 50,
      facets: {
        byType: { image: 2, pdf: 3, video: 0, audio: 0, office: 1, other: 4 },
        total: 10,
      },
    });
  });

  it('personal scope: authorizes via assertPersonalAccess for the caller', async () => {
    const { svc, s } = harness();
    await svc.searchDatabank(USER, { personal: true }, DatabankDepartment.PROCESSING);
    expect(s.assertPersonalAccess).toHaveBeenCalledWith('u1', USER);
  });

  it('scopes the query to the caller for personal search (ownerUserId bound)', async () => {
    const { svc, resultsQ } = harness();
    await svc.searchDatabank(USER, { personal: true }, DatabankDepartment.PROCESSING);
    expect(String(resultsQ().sql)).toContain('"ownerUserId" =');
    expect(resultsQ().values).toContain('u1');
  });

  it('400s when NEITHER clientId nor personal is given (before any query)', async () => {
    const { svc, prisma } = harness();
    await expect(svc.searchDatabank(USER, {}, DatabankDepartment.PROCESSING)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('400s when BOTH clientId and personal are given (before any query)', async () => {
    const { svc, prisma, s } = harness();
    await expect(
      svc.searchDatabank(USER, { clientId: 'c1', personal: true }, DatabankDepartment.PROCESSING),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(s.assertClientReadAccess).not.toHaveBeenCalled();
  });

  it('clamps pagination: pageSize > 200 => 200, page < 1 => 1', async () => {
    const { svc, resultsQ } = harness();
    const out = await svc.searchDatabank(USER, { clientId: 'c1', page: 0, pageSize: 9999 }, DatabankDepartment.PROCESSING);
    expect(out.page).toBe(1);
    expect(out.pageSize).toBe(200);
    // LIMIT 200 OFFSET 0 are bound values, not literals.
    expect(resultsQ().values).toEqual(expect.arrayContaining([200, 0]));
  });

  it('clamps pageSize below 1 up to 1', async () => {
    const { svc } = harness();
    const out = await svc.searchDatabank(USER, { clientId: 'c1', pageSize: 0 }, DatabankDepartment.PROCESSING);
    expect(out.pageSize).toBe(1);
  });

  it('empty/blank q => NO full-text predicate, orders by createdAt only', async () => {
    const { svc, resultsQ } = harness();
    await svc.searchDatabank(USER, { clientId: 'c1', q: '   ' }, DatabankDepartment.PROCESSING);
    const sql = String(resultsQ().sql);
    expect(sql).not.toContain('websearch_to_tsquery');
    expect(sql).toContain('ORDER BY "createdAt" DESC');
    expect(sql).not.toContain('ts_rank');
  });

  it('non-empty q => bound parameter, NEVER concatenated into SQL (injection-safe)', async () => {
    const { svc, calls, resultsQ } = harness();
    const needle = "o'brien'; DROP TABLE x; --";
    await svc.searchDatabank(USER, { clientId: 'c1', q: needle }, DatabankDepartment.PROCESSING);

    // No query text ever contains the raw q — every one is a Prisma.Sql template.
    for (const c of calls) {
      expect(String(c.sql)).not.toContain(needle);
      expect(String(c.sql)).not.toContain('DROP TABLE');
    }
    const rq = resultsQ();
    expect(String(rq.sql)).toContain('websearch_to_tsquery');
    expect(String(rq.sql)).toContain('ts_rank');
    expect(rq.values).toContain(needle); // the tsquery / rank argument
    expect(rq.values).toContain(`%${needle}%`); // the ILIKE substring argument
  });

  it('non-empty q matches tags by substring (tags are unstemmed vs the english query, so ILIKE covers them)', async () => {
    const { svc, resultsQ } = harness();
    await svc.searchDatabank(USER, { clientId: 'c1', q: 'visas' }, DatabankDepartment.PROCESSING);
    const sql = String(resultsQ().sql);
    // fileName AND the joined tags both get a substring fallback alongside @@.
    expect(sql).toContain(`"fileName" ILIKE`);
    expect(sql).toContain(`array_to_string("tags", ' ') ILIKE`);
  });

  it('ORDER BY always ends with the unique "id" tiebreaker (stable pagination)', async () => {
    const { svc, resultsQ } = harness();
    await svc.searchDatabank(USER, { clientId: 'c1', q: 'passport' }, DatabankDepartment.PROCESSING);
    expect(String(resultsQ().sql)).toMatch(/ORDER BY ts_rank[\s\S]*"createdAt" DESC, "id" DESC/);

    const noQ = harness();
    await noQ.svc.searchDatabank(USER, { clientId: 'c1' }, DatabankDepartment.PROCESSING);
    expect(String(noQ.resultsQ().sql)).toContain('ORDER BY "createdAt" DESC, "id" DESC');
  });

  it('a type filter narrows results and total is summed from the selected facet buckets', async () => {
    const { svc, resultsQ, facetQ } = harness();
    const out = await svc.searchDatabank(USER, { clientId: 'c1', types: ['image', 'pdf', 'bogus'] }, DatabankDepartment.PROCESSING);
    // Results query carries the mime-bucket predicate; facet query does NOT.
    expect(String(resultsQ().sql)).toContain('ILIKE'); // image bucket predicate
    expect(String(facetQ().sql)).not.toContain('LIMIT');
    // total = image(2) + pdf(3); unknown bucket "bogus" ignored.
    expect(out.total).toBe(5);
    expect(out.facets.total).toBe(10); // facets are computed WITHOUT the type filter
  });

  it('folderId null scopes to the databank root', async () => {
    const { svc, resultsQ } = harness();
    await svc.searchDatabank(USER, { clientId: 'c1', folderId: null }, DatabankDepartment.PROCESSING);
    expect(String(resultsQ().sql)).toContain('"folderId" IS NULL');
  });
});

describe('DatabankService.updateFile — rename + metadata', () => {
  function updHarness() {
    const prisma = {
      databankFile: { update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })) },
    };
    const svc = new DatabankService(prisma as never, {} as never);
    const s = svc as any;
    s.loadFile = jest.fn().mockResolvedValue({ id: 'f1', clientId: 'c1', ownerUserId: null });
    return { svc, prisma, s };
  }

  it('reuses the write-access check (loadFile) and sets trimmed, de-duped, capped tags + description', async () => {
    const { svc, prisma, s } = updHarness();
    const out = await svc.updateFile(
      'f1',
      { fileName: 'passport.pdf', description: '  a scan  ', tags: [' visa ', 'visa', '', 'urgent'] },
      USER,
    );
    expect(s.loadFile).toHaveBeenCalledWith('f1', USER);
    const data = prisma.databankFile.update.mock.calls[0][0].data;
    expect(data.fileName).toBe('passport.pdf');
    expect(data.description).toBe('a scan');
    expect(data.tags).toEqual(['visa', 'urgent']); // trimmed, empty dropped, de-duped
    // The response select includes the new metadata columns.
    const select = prisma.databankFile.update.mock.calls[0][0].select;
    expect(select).toMatchObject({ description: true, tags: true });
    expect(out).toMatchObject({ id: 'f1', description: 'a scan', tags: ['visa', 'urgent'] });
  });

  it('caps tags at 50', async () => {
    const { svc, prisma } = updHarness();
    const tags = Array.from({ length: 80 }, (_, i) => `t${i}`);
    await svc.updateFile('f1', { tags }, USER);
    expect(prisma.databankFile.update.mock.calls[0][0].data.tags).toHaveLength(50);
  });

  it('clears the description on an explicit null and leaves other columns untouched', async () => {
    const { svc, prisma } = updHarness();
    await svc.updateFile('f1', { description: null }, USER);
    const data = prisma.databankFile.update.mock.calls[0][0].data;
    expect(data.description).toBeNull();
    expect(data).not.toHaveProperty('fileName');
    expect(data).not.toHaveProperty('tags');
  });

  it('a fileName-only body is a plain rename (previous behaviour unchanged)', async () => {
    const { svc, prisma } = updHarness();
    await svc.updateFile('f1', { fileName: ' renamed.pdf ' }, USER);
    expect(prisma.databankFile.update.mock.calls[0][0].data).toEqual({ fileName: 'renamed.pdf' });
  });

  it('rejects a rename to a blocked executable extension', async () => {
    const { svc } = updHarness();
    await expect(svc.updateFile('f1', { fileName: 'scan.exe' }, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
