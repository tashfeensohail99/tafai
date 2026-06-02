/**
 * P4e — Submission Package Service
 *
 * Auto-assembles a single merged PDF from all ACCEPTED documents on a case,
 * prepended by a branded cover page, and uploads it to storage.
 *
 * The caller (controller) is responsible for permission checks; this service
 * still re-validates gate conditions before assembling.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFPage, StandardFonts, rgb, degrees } from 'pdf-lib';
import {
  DocumentCriticality,
  DocumentItemStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { StorageService } from '../storage/storage.service';

export interface SubmissionPackageResult {
  /** Storage key of the assembled PDF */
  key: string;
  fileName: string;
  sizeBytes: number;
  documentCount: number;
  assembledAt: Date;
  /** Short-lived signed URL to download immediately */
  signedUrl: string;
}

@Injectable()
export class SubmissionPackageService {
  private readonly logger = new Logger(SubmissionPackageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // --------------------------------------------------------------------------
  // Public: assemble
  // --------------------------------------------------------------------------

  async assemblePackage(
    caseId: string,
    user: RequestUser,
  ): Promise<SubmissionPackageResult> {
    // 1. Load case (throws 404 if not found) + access check
    const processingCase = await this.prisma.processingCase.findUnique({
      where: { id: caseId },
      include: { client: true, lead: true },
    });
    if (!processingCase) {
      throw new BadRequestException('Case not found');
    }
    const canViewAll = user.permissions.includes('processing.case.view_all');
    const isAssigned = processingCase.assignedOfficerId === user.id;
    if (!canViewAll && !isAssigned) {
      throw new BadRequestException('Access denied');
    }

    // 2. Gate: only assemble if all critical/required docs are accepted
    const blockers = await this.computeBlockers(caseId);
    if (blockers.length > 0) {
      throw new BadRequestException({
        message: 'Cannot assemble: submission quality gate failed',
        blockers,
      });
    }

    // 3. Fetch ACCEPTED docs ordered by criticality then sortOrder
    const items = await this.prisma.caseDocumentItem.findMany({
      where: {
        caseId,
        status: { in: [DocumentItemStatus.ACCEPTED, DocumentItemStatus.WAIVED] },
      },
      include: {
        latestVersion: {
          select: {
            storageKey: true,
            fileName: true,
            mimeType: true,
            versionNumber: true,
          },
        },
      },
      orderBy: [{ criticality: 'asc' }, { sortOrder: 'asc' }],
    });

    // 4. Download each accepted doc's file bytes
    const docFiles: Array<{
      name: string;
      criticality: string;
      bytes: Buffer;
      mimeType: string;
    }> = [];

    for (const item of items) {
      const ver = item.latestVersion;
      if (!ver?.storageKey) continue;
      try {
        const { bytes, mimeType } = await this.storage.download(ver.storageKey);
        const resolvedMime = mimeType ?? ver.mimeType ?? 'application/octet-stream';
        if (
          resolvedMime === 'application/pdf' ||
          resolvedMime === 'image/jpeg' ||
          resolvedMime === 'image/png'
        ) {
          docFiles.push({
            name: item.documentName,
            criticality: item.criticality,
            bytes,
            mimeType: resolvedMime,
          });
        } else {
          this.logger.warn(
            `P4e: skipping doc "${item.documentName}" (unsupported mime: ${resolvedMime})`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `P4e: failed to download "${item.documentName}" — skipping: ${(err as Error).message}`,
        );
      }
    }

    // 5. Assemble with pdf-lib
    const mergedPdf = await this.buildMergedPdf(
      processingCase,
      docFiles,
    );
    const mergedBytes = await mergedPdf.save();
    const buffer = Buffer.from(mergedBytes);

    // 6. Upload
    const clientName =
      (processingCase.client as { fullName?: string } | null)?.fullName ??
      (processingCase.lead as { fullName?: string } | null)?.fullName ??
      'Client';
    const safeClientName = clientName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const fileName = `submission-package-${safeClientName}-${caseId.slice(0, 8)}.pdf`;

    const upload = await this.storage.upload(
      buffer,
      'application/pdf',
      `processing/cases/${caseId}/submissions`,
      fileName,
    );

    // 7. Persist on the case
    const now = new Date();
    await this.prisma.processingCase.update({
      where: { id: caseId },
      data: {
        submissionPackageKey: upload.key,
        submissionPackageAssembledAt: now,
        submissionPackageDocCount: docFiles.length,
      },
    });

    // 8. Audit
    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'SUBMISSION_PACKAGE_ASSEMBLED',
        entityType: 'ProcessingCase',
        entityId: caseId,
        newValues: {
          documentCount: docFiles.length,
          sizeBytes: upload.sizeBytes,
          storageKey: upload.key,
        },
      },
    });

    const signedUrl = await this.storage.getSignedUrl(upload.key);

    return {
      key: upload.key,
      fileName,
      sizeBytes: upload.sizeBytes,
      documentCount: docFiles.length,
      assembledAt: now,
      signedUrl,
    };
  }

  // --------------------------------------------------------------------------
  // Public: get existing package info
  // --------------------------------------------------------------------------

  async getPackageInfo(
    caseId: string,
    user: RequestUser,
  ): Promise<(SubmissionPackageResult & { exists: boolean }) | { exists: false }> {
    const processingCase = await this.prisma.processingCase.findUnique({
      where: { id: caseId },
      select: {
        assignedOfficerId: true,
        submissionPackageKey: true,
        submissionPackageAssembledAt: true,
        submissionPackageDocCount: true,
      },
    });
    if (!processingCase) {
      throw new BadRequestException('Case not found');
    }
    const canViewAll = user.permissions.includes('processing.case.view_all');
    const isAssigned = processingCase.assignedOfficerId === user.id;
    if (!canViewAll && !isAssigned) {
      throw new BadRequestException('Access denied');
    }
    if (!processingCase.submissionPackageKey) {
      return { exists: false };
    }
    const signedUrl = await this.storage.getSignedUrl(
      processingCase.submissionPackageKey,
    );
    return {
      exists: true,
      key: processingCase.submissionPackageKey,
      fileName: processingCase.submissionPackageKey.split('/').pop() ?? 'submission-package.pdf',
      sizeBytes: 0, // not stored — caller can check via Content-Length if needed
      documentCount: processingCase.submissionPackageDocCount ?? 0,
      assembledAt: processingCase.submissionPackageAssembledAt ?? new Date(),
      signedUrl,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async computeBlockers(caseId: string): Promise<string[]> {
    const items = await this.prisma.caseDocumentItem.findMany({
      where: {
        caseId,
        criticality: { in: [DocumentCriticality.CRITICAL, DocumentCriticality.REQUIRED] },
      },
      select: {
        documentName: true,
        status: true,
        validityExpiryDate: true,
        attestationStatus: true,
      },
    });
    const blockers: string[] = [];
    const now = new Date();
    for (const item of items) {
      if (
        item.status !== DocumentItemStatus.ACCEPTED &&
        item.status !== DocumentItemStatus.WAIVED &&
        item.status !== DocumentItemStatus.NOT_APPLICABLE
      ) {
        blockers.push(`"${item.documentName}" is not accepted (status: ${item.status})`);
      } else if (
        item.status === DocumentItemStatus.ACCEPTED &&
        item.validityExpiryDate &&
        item.validityExpiryDate < now
      ) {
        blockers.push(`"${item.documentName}" has expired`);
      } else if (item.attestationStatus === 'REQUIRED_PENDING') {
        blockers.push(`"${item.documentName}" attestation is still pending`);
      }
    }
    return blockers;
  }

  private async buildMergedPdf(
    processingCase: { id: string; service: string; targetCountry: string },
    docFiles: Array<{ name: string; criticality: string; bytes: Buffer; mimeType: string }>,
  ): Promise<PDFDocument> {
    const mergedDoc = await PDFDocument.create();

    // --- Cover page ---
    await this.addCoverPage(mergedDoc, processingCase, docFiles);

    // --- Document pages ---
    for (const doc of docFiles) {
      try {
        if (doc.mimeType === 'application/pdf') {
          const srcDoc = await PDFDocument.load(doc.bytes, { ignoreEncryption: true });
          const pageIndices = srcDoc.getPageIndices();
          const copied = await mergedDoc.copyPages(srcDoc, pageIndices);
          for (const page of copied) {
            mergedDoc.addPage(page);
          }
        } else if (doc.mimeType === 'image/jpeg') {
          await this.addImagePage(mergedDoc, doc.bytes, 'jpeg', doc.name);
        } else if (doc.mimeType === 'image/png') {
          await this.addImagePage(mergedDoc, doc.bytes, 'png', doc.name);
        }
      } catch (err) {
        this.logger.warn(`P4e: failed to embed "${doc.name}": ${(err as Error).message}`);
        // Continue — don't let one bad doc abort the entire package
      }
    }

    return mergedDoc;
  }

  private async addCoverPage(
    doc: PDFDocument,
    processingCase: { id: string; service: string; targetCountry: string },
    docFiles: Array<{ name: string; criticality: string }>,
  ): Promise<void> {
    const page = doc.addPage([595, 842]); // A4 portrait
    const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);

    const { width, height } = page.getSize();
    const margin = 48;

    // Header band
    page.drawRectangle({
      x: 0,
      y: height - 100,
      width,
      height: 100,
      color: rgb(0.07, 0.38, 0.71),
    });

    page.drawText('SUBMISSION PACKAGE', {
      x: margin,
      y: height - 55,
      size: 20,
      font: helveticaBold,
      color: rgb(1, 1, 1),
    });

    page.drawText('Tashfeen Immigration Solutions', {
      x: margin,
      y: height - 78,
      size: 11,
      font: helvetica,
      color: rgb(0.85, 0.92, 1),
    });

    // Case info block
    const infoY = height - 160;
    const col2X = margin + 160;
    const lineH = 22;

    const infoRows: [string, string][] = [
      ['Case ID', processingCase.id.slice(0, 8).toUpperCase()],
      ['Service', processingCase.service],
      ['Country', processingCase.targetCountry],
      ['Assembled', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
      ['Documents', String(docFiles.length)],
    ];

    for (let i = 0; i < infoRows.length; i++) {
      const y = infoY - i * lineH;
      page.drawText(infoRows[i][0], {
        x: margin,
        y,
        size: 10,
        font: helveticaBold,
        color: rgb(0.3, 0.3, 0.3),
      });
      page.drawText(infoRows[i][1], {
        x: col2X,
        y,
        size: 10,
        font: helvetica,
        color: rgb(0.1, 0.1, 0.1),
      });
    }

    // Divider
    const dividerY = infoY - infoRows.length * lineH - 14;
    page.drawLine({
      start: { x: margin, y: dividerY },
      end: { x: width - margin, y: dividerY },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });

    // Document list
    let listY = dividerY - 28;
    page.drawText('INCLUDED DOCUMENTS', {
      x: margin,
      y: listY,
      size: 9,
      font: helveticaBold,
      color: rgb(0.07, 0.38, 0.71),
    });
    listY -= 18;

    for (let i = 0; i < docFiles.length; i++) {
      if (listY < margin) break; // don't overflow cover page
      const critLabel = docFiles[i].criticality === 'CRITICAL' ? '★' : '○';
      page.drawText(`${critLabel}  ${docFiles[i].name}`, {
        x: margin,
        y: listY,
        size: 9,
        font: helvetica,
        color: rgb(0.15, 0.15, 0.15),
      });
      listY -= 16;
    }

    // Footer
    page.drawText('This document is confidential and intended solely for the named authority.', {
      x: margin,
      y: 28,
      size: 8,
      font: helvetica,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  private async addImagePage(
    doc: PDFDocument,
    bytes: Buffer,
    type: 'jpeg' | 'png',
    docName: string,
  ): Promise<void> {
    const image =
      type === 'jpeg'
        ? await doc.embedJpg(bytes)
        : await doc.embedPng(bytes);

    const page = doc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    const margin = 32;
    const usableW = width - margin * 2;
    // Reserve top 24px for label
    const usableH = height - margin * 2 - 24;

    const imgDims = image.scaleToFit(usableW, usableH);
    const x = margin + (usableW - imgDims.width) / 2;
    const y = margin + (usableH - imgDims.height) / 2;

    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(docName, {
      x: margin,
      y: height - margin - 14,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    page.drawImage(image, { x, y, width: imgDims.width, height: imgDims.height });
  }
}
