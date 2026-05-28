/**
 * Normalize a case's service to a canonical code and (re)build its document
 * checklist from the matching template — for cases that were acknowledged
 * with a non-canonical/legacy service (e.g. "study") and ended up with an
 * empty checklist. Mirrors ProcessingService.acknowledgeIntake's checklist
 * build (exact (service,country) → (service,GLOBAL) ladder).
 *
 * Idempotent guard: refuses to run if the case already has document items,
 * so it can't duplicate an existing checklist.
 *
 *   npx ts-node prisma/rebuild-case-checklist.ts <caseId> <CANONICAL_SERVICE>
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const CANON = ['STUDY_VISA','WORK_PERMIT','PR_CASE','VISIT_VISA','TOURIST_VISA','SPOUSE_VISA','E2_VISA','CBI','JR_RESUBMISSION'];

async function main() {
  const caseId = process.argv[2];
  const service = process.argv[3];
  if (!caseId || !service) { console.log('Usage: ts-node rebuild-case-checklist.ts <caseId> <SERVICE>'); return; }
  if (!CANON.includes(service)) { throw new Error(`"${service}" is not a canonical service code. One of: ${CANON.join(', ')}`); }

  const c = await prisma.processingCase.findUnique({
    where: { id: caseId },
    select: { id: true, service: true, targetCountry: true },
  });
  if (!c) throw new Error('case not found');

  const existing = await prisma.caseDocumentItem.count({ where: { caseId } });
  if (existing > 0) {
    console.log(`Case already has ${existing} document item(s) — refusing to rebuild. Nothing changed.`);
    return;
  }

  // Same lookup ladder as acknowledgeIntake.
  let templates = await prisma.documentRequirementTemplate.findMany({
    where: { service, targetCountry: c.targetCountry, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (templates.length === 0) {
    templates = await prisma.documentRequirementTemplate.findMany({
      where: { service, targetCountry: 'GLOBAL', isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
  if (templates.length === 0) {
    throw new Error(`No templates for ${service} (country ${c.targetCountry} or GLOBAL). Aborting.`);
  }

  await prisma.$transaction(async (tx) => {
    if (c.service !== service) {
      await tx.processingCase.update({ where: { id: caseId }, data: { service } });
      console.log(`Normalized service "${c.service}" -> "${service}"`);
    }
    await tx.caseDocumentItem.createMany({
      data: templates.map((t) => ({
        caseId,
        templateId: t.id,
        documentName: t.documentName,
        description: t.description ?? undefined,
        criticality: t.criticality,
        expectedFormats: t.expectedFormats,
        maxFileSizeMb: t.maxFileSizeMb,
        validityRule: t.validityRule,
        validityMonths: t.validityMonths ?? undefined,
        validityBufferDays: t.validityBufferDays,
        sortOrder: t.sortOrder,
      })),
    });
    await tx.processingAuditLog.create({
      data: {
        caseId,
        action: 'checklist_rebuilt',
        entityType: 'processing_case',
        entityId: caseId,
        newValues: { service, documentsCreated: templates.length, reason: 'legacy non-canonical service had empty checklist' },
      },
    });
  });

  console.log(`✓ Built ${templates.length} document items for case ${caseId}.`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
