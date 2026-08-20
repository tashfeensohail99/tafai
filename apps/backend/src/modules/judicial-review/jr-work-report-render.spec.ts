/**
 * Unit tests for the JR associate work-report RENDER + FINALIZE surface (§11.7,
 * PR 10C). Prisma, StorageService, the PDF render service and EmailService are
 * fully mocked (jest.fn) — no real database, storage bucket, Chromium or SMTP.
 *
 * Covers the canonical corrections:
 *   - finalize REFUSES (throws) when durable storage is unavailable (LOCAL mode:
 *     download() rejects) and NEVER mutates the report status — so it can't freeze
 *     a phantom PDF and lock the enrichments (correction #1).
 *   - a healthy round-trip flips the report to FINALIZED with a frozen key + sha.
 *   - the PDF service renderHtml is a decodable branded document (smoke test).
 */

import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JrWorkReportService } from './jr-work-report.service';
import { JrWorkReportPdfService } from './jr-work-report-pdf.service';
import type { HydratedWorkReport } from './jr-work-report.service';

const ASSOCIATE = {
  id: 'assoc-1',
  email: 'assoc@tashfeengroup.com',
  roles: ['jr_associate'],
  permissions: ['jr.report.generate'],
};

const DRAFT_REPORT = {
  id: 'report-1',
  subjectAssociateUserId: 'assoc-1',
  periodFrom: new Date('2026-08-01T00:00:00Z'),
  periodTo: new Date('2026-08-31T00:00:00Z'),
  canViewAllAtCompile: false,
  status: 'DRAFT' as const,
  frozenPdfKey: null,
  frozenPdfSha256: null,
  createdByUserId: 'assoc-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BODY = {
  hasActivity: true,
  summary: {
    matterCount: 1,
    draftVersions: 2,
    submittedForReview: 1,
    approvals: 0,
    changesRequested: 0,
    filings: 0,
    caseNotes: 0,
    wins: 0,
  },
  matters: [{ matterId: 'm-1' }],
  caseNotes: [],
  deadlines: { scope: 'matter-level', onTime: 0, missed: 0, pending: 0, total: 0, items: [] },
};

function buildFinalize(opts: { download: jest.Mock }) {
  const update = jest.fn().mockImplementation((args: any) =>
    Promise.resolve({ ...DRAFT_REPORT, ...args.data }),
  );
  const prisma = {
    jrWorkReport: { findUnique: jest.fn().mockResolvedValue(DRAFT_REPORT), update },
    jrWorkReportNote: { findMany: jest.fn().mockResolvedValue([]) },
    jrWorkReportAttachment: { findMany: jest.fn().mockResolvedValue([]) },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        email: 'assoc@tashfeengroup.com',
        employee: { firstName: 'A', lastName: 'B' },
      }),
    },
  };
  const compiler = { compileBody: jest.fn().mockResolvedValue(BODY) };
  const pdfBytes = Buffer.from('%PDF-1.4 fake pdf bytes');
  const storage = {
    uploadAt: jest.fn().mockResolvedValue({ key: 'k', bucket: 'receipts', sizeBytes: pdfBytes.length, mimeType: 'application/pdf' }),
    download: opts.download,
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const pdf = { render: jest.fn().mockResolvedValue(pdfBytes), renderHtml: jest.fn() };
  const email = { sendJrWorkReport: jest.fn().mockResolvedValue(true) };
  const service = new JrWorkReportService(
    prisma as any,
    compiler as any,
    storage as any,
    {} as any,
    pdf as any,
    email as any,
  );
  return { service, prisma, storage, pdf, update, pdfBytes };
}

describe('JR work-report finalize (§11.7, PR 10C)', () => {
  it('REFUSES to finalize when durable storage is unavailable (LOCAL) and never mutates status', async () => {
    // LOCAL StorageService throws on download — the post-upload read-back trips it.
    const download = jest.fn().mockRejectedValue(new Error('[LOCAL] download not supported'));
    const { service, update, pdf } = buildFinalize({ download });

    await expect(service.finalize('report-1', ASSOCIATE as any)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // The PDF WAS rendered (we probe by rendering first) …
    expect(pdf.render).toHaveBeenCalledTimes(1);
    // … but the status was NEVER flipped — no phantom PDF, enrichments stay open.
    expect(update).not.toHaveBeenCalled();
  });

  it('finalizes to FINALIZED with a frozen key + sha when the round-trip is healthy', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 fake pdf bytes');
    const download = jest.fn().mockResolvedValue({ bytes: pdfBytes, mimeType: 'application/pdf' });
    const { service, update, storage } = buildFinalize({ download });

    const res = await service.finalize('report-1', ASSOCIATE as any);

    expect(storage.uploadAt).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('FINALIZED');
    expect(data.frozenPdfKey).toMatch(/^jr\/work-reports\/report-1\/report-/);
    expect(data.frozenPdfSha256).toBe(createHash('sha256').update(pdfBytes).digest('hex'));
    expect(data.matterIdsSnapshot).toEqual(['m-1']);
    expect(res.report.status).toBe('FINALIZED');
  });
});

describe('JR work-report PDF renderHtml (§11.7, PR 10C)', () => {
  function hydrated(): HydratedWorkReport {
    return {
      report: {
        id: 'report-1',
        subjectAssociateUserId: 'assoc-1',
        subjectName: 'Nauman Associate',
        periodFrom: new Date('2026-08-01T00:00:00Z'),
        periodTo: new Date('2026-08-31T00:00:00Z'),
        status: 'DRAFT',
        canViewAllAtCompile: false,
        createdByUserId: 'assoc-1',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        updatedAt: new Date('2026-09-01T00:00:00Z'),
        frozenPdfKey: null,
        frozenPdfSha256: null,
      },
      body: {
        subjectAssociateUserId: 'assoc-1',
        period: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' },
        generatedAt: '2026-09-01T00:00:00.000Z',
        hasActivity: true,
        summary: {
          matterCount: 1,
          draftVersions: 3,
          submittedForReview: 1,
          approvals: 1,
          changesRequested: 0,
          filings: 1,
          caseNotes: 1,
          wins: 1,
        },
        matters: [
          {
            matterId: 'm-1',
            matterNumber: 'JR-2026-00001',
            styleOfCause: 'X v MCI',
            stage: 'FILED',
            clientId: 'c-1',
            clientName: 'Ada Lovelace',
            clientReferenceCode: 'C-1',
            isWin: true,
            draftVersions: 3,
            actions: [],
          },
        ],
        caseNotes: [
          { id: 'n-1', matterId: 'm-1', noteType: 'GENERAL', content: 'Filed the AR.', createdAt: new Date('2026-08-10T00:00:00Z') },
        ],
        deadlines: {
          scope: 'matter-level',
          onTime: 1,
          missed: 0,
          pending: 0,
          total: 1,
          items: [
            {
              matterId: 'm-1',
              milestoneKey: 'PERFECT_APPLICATION',
              label: 'Perfect application',
              computedDueAt: new Date('2026-08-20T00:00:00Z'),
              status: 'MET',
              isFatal: true,
            },
          ],
        },
      },
      notes: [
        { id: 'rn-1', authorUserId: 'assoc-1', content: 'Good week on this file.', createdAt: new Date('2026-08-31T00:00:00Z') },
      ],
      attachments: [],
    };
  }

  it('produces a branded HTML document with the subject, period, DRAFT pill and matter', async () => {
    const prisma = {
      jrWorkReportAttachment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const storage = { download: jest.fn() };
    const pdf = { renderHtml: jest.fn() };
    const svc = new JrWorkReportPdfService(prisma as any, storage as any, pdf as any);

    const html = await svc.renderHtml(hydrated());

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Nauman Associate');
    expect(html).toContain('JR-2026-00001');
    expect(html).toContain('DRAFT');
    expect(html).toContain('Summary');
    expect(html).toContain('Good week on this file.');
    // No attachments → no image download attempted.
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('embeds an image attachment as a base64 data URI (never a signed URL) and serializes downloads', async () => {
    const h = hydrated();
    const prisma = {
      jrWorkReportAttachment: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a-1', kind: 'IMAGE', mimeType: 'image/png', storageKey: 'jr/k1.png', transcript: null, transcriptStatus: 'DONE' },
          { id: 'a-2', kind: 'VOICE_NOTE', mimeType: 'audio/webm', storageKey: 'jr/k2.webm', transcript: 'salam matter update', transcriptStatus: 'DONE' },
        ]),
      },
    };
    const storage = {
      download: jest.fn().mockResolvedValue({ bytes: Buffer.from('imgbytes'), mimeType: 'image/png' }),
    };
    const svc = new JrWorkReportPdfService(prisma as any, storage as any, { renderHtml: jest.fn() } as any);

    const html = await svc.renderHtml(h);

    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('http'); // no signed-URL <img src>
    // The voice note prints its transcript + the in-app audio marker.
    expect(html).toContain('salam matter update');
    expect(html).toContain('Voice note — audio in-app');
    // Only the IMAGE was downloaded (voice notes are never downloaded).
    expect(storage.download).toHaveBeenCalledTimes(1);
    expect(storage.download).toHaveBeenCalledWith('jr/k1.png');
  });
});
