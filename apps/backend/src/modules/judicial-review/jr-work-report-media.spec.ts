/**
 * Unit tests for the JR associate work-report MEDIA enrichments (§11.7, PR 10B).
 * Prisma, StorageService and OpenAiService are fully mocked (jest.fn) — no real
 * database, storage bucket or Whisper call. Follows the jr spec mocking style
 * (jr-work-report.spec.ts).
 *
 * Covers:
 *   - addImage writes an IMAGE attachment (durable storageKey, no transcription).
 *   - addVoice with transcribe→{text} persists the transcript + transcriptStatus DONE.
 *   - addVoice with transcribe→null saves FAILED (never crashes).
 *   - attachmentSignedUrl for an attachment whose reportId ≠ the path :id 404s (IDOR).
 *   - addImage on a FINALIZED report throws (DRAFT-only lock).
 */

import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { JrWorkReportService } from './jr-work-report.service';

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

function imageFile(): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-png-bytes'),
    mimetype: 'image/png',
    originalname: 'screenshot.png',
    size: 14,
  } as Express.Multer.File;
}

function audioFile(): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-webm-bytes'),
    mimetype: 'audio/webm',
    originalname: 'note.webm',
    size: 15,
  } as Express.Multer.File;
}

/**
 * Build the service with fully-mocked collaborators. `report` is what
 * jrWorkReport.findUnique resolves to; `attachment` (if given) is what
 * jrWorkReportAttachment.findFirst resolves to WHEN the where.reportId matches
 * the attachment's real reportId (so the reportId filter — the IDOR guard — is
 * exercised, not assumed).
 */
function build(opts: { report?: any; attachment?: any } = {}) {
  const attachmentCreate = jest.fn().mockResolvedValue({ id: 'att-new' });
  const attachmentUpdate = jest.fn().mockResolvedValue({});
  const attachmentFindFirst = jest.fn().mockImplementation((args: any) => {
    const att = opts.attachment;
    if (att && args?.where?.id === att.id && args?.where?.reportId === att.reportId) {
      return Promise.resolve(att);
    }
    return Promise.resolve(null);
  });

  const prisma = {
    jrWorkReport: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.report === undefined ? DRAFT_REPORT : opts.report),
    },
    jrWorkReportNote: { findMany: jest.fn().mockResolvedValue([]) },
    jrWorkReportAttachment: {
      create: attachmentCreate,
      update: attachmentUpdate,
      findFirst: attachmentFindFirst,
      findMany: jest.fn().mockResolvedValue([]),
    },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        email: 'assoc@tashfeengroup.com',
        employee: { firstName: 'A', lastName: 'B' },
      }),
    },
  };

  const compiler = { compileBody: jest.fn().mockResolvedValue({ hasActivity: false }) };
  const storage = {
    upload: jest.fn().mockResolvedValue({
      key: 'jr/work-reports/report-1/uuid.png',
      bucket: 'receipts',
      sizeBytes: 14,
      mimeType: 'image/png',
    }),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/obj?token=abc'),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const openai = { transcribe: jest.fn() };
  const pdf = { render: jest.fn(), renderHtml: jest.fn() };
  const email = { sendJrWorkReport: jest.fn().mockResolvedValue(true) };

  const service = new JrWorkReportService(
    prisma as any,
    compiler as any,
    storage as any,
    openai as any,
    pdf as any,
    email as any,
  );
  return { service, prisma, storage, openai, attachmentCreate, attachmentUpdate };
}

describe('JR work-report media enrichments (§11.7, PR 10B)', () => {
  it('addImage writes an IMAGE attachment with a durable storageKey', async () => {
    const { service, storage, attachmentCreate } = build();

    await service.addImage('report-1', imageFile(), ASSOCIATE as any);

    expect(storage.upload).toHaveBeenCalledTimes(1);
    const data = attachmentCreate.mock.calls[0][0].data;
    expect(data.kind).toBe('IMAGE');
    expect(data.reportId).toBe('report-1');
    expect(data.storageKey).toBe('jr/work-reports/report-1/uuid.png');
    expect(data.createdByUserId).toBe('assoc-1');
    // No transcription on an image.
    expect(data.transcript).toBeUndefined();
  });

  it('addVoice with a successful transcription sets transcript + DONE', async () => {
    const { service, openai, attachmentCreate } = build();
    openai.transcribe.mockResolvedValue({ text: 'salam, matter update', latencyMs: 12 });

    await service.addVoice('report-1', audioFile(), ASSOCIATE as any);

    expect(openai.transcribe).toHaveBeenCalledTimes(1);
    const data = attachmentCreate.mock.calls[0][0].data;
    expect(data.kind).toBe('VOICE_NOTE');
    expect(data.transcript).toBe('salam, matter update');
    expect(data.transcriptStatus).toBe('DONE');
    expect(data.audioCodecExt).toBe('webm');
  });

  it('addVoice with a null transcription saves FAILED and does not crash', async () => {
    const { service, openai, attachmentCreate } = build();
    openai.transcribe.mockResolvedValue(null);

    await expect(
      service.addVoice('report-1', audioFile(), ASSOCIATE as any),
    ).resolves.toBeDefined();

    const data = attachmentCreate.mock.calls[0][0].data;
    expect(data.kind).toBe('VOICE_NOTE');
    expect(data.transcript).toBeNull();
    expect(data.transcriptStatus).toBe('FAILED');
  });

  it('attachmentSignedUrl 404s when the attachment belongs to a different report (IDOR)', async () => {
    // The attachment really lives under report-OTHER, but the caller asks under
    // report-1 → the reportId filter yields null → 404 (never leaks the object).
    const { service, storage } = build({
      attachment: { id: 'att-9', reportId: 'report-OTHER', storageKey: 'k', deletedAt: null },
    });

    await expect(
      service.attachmentSignedUrl('report-1', 'att-9', ASSOCIATE as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('attachmentSignedUrl mints a fresh signed URL when reportId matches', async () => {
    const { service, storage } = build({
      attachment: { id: 'att-9', reportId: 'report-1', storageKey: 'jr/k.png', deletedAt: null },
    });

    const res = await service.attachmentSignedUrl('report-1', 'att-9', ASSOCIATE as any);
    expect(res.url).toBe('https://signed.example/obj?token=abc');
    expect(storage.getSignedUrl).toHaveBeenCalledWith('jr/k.png');
  });

  it('addImage on a FINALIZED report throws (DRAFT-only)', async () => {
    const { service, storage } = build({
      report: { ...DRAFT_REPORT, status: 'FINALIZED' },
    });

    await expect(
      service.addImage('report-1', imageFile(), ASSOCIATE as any),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    // Never even uploaded — the DRAFT guard runs before any storage write.
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
