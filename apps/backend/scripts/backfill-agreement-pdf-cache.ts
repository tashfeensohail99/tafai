/**
 * One-off backfill — refresh previously-generated agreement PDFs with the
 * improved page layout (see agreement-render.service `wrapDocument`).
 *
 * The PDF is rendered from each agreement's stored `contentHtml` through the
 * shared HTML/CSS wrapper, and the result is CACHED in `generatedPdfKey`. The
 * layout fix lives in that wrapper, so any FRESH render is already correct —
 * we just need to drop the cached copy so it regenerates. Regeneration is
 * lazy: the next preview / pdf-url / send re-renders with the new layout
 * (getPdfUrl, previewPdf and the hardened sendToClient all regenerate when the
 * cache is empty), so no headless-Chrome run is needed here — this only clears
 * pointers.
 *
 * SCOPE — only UNSIGNED, non-deleted agreements that actually have a cached
 * PDF. Signed/executed agreements are left alone: their legally-binding copy
 * is the client's uploaded scan stored on the ServiceContract, which this
 * never touches. Old cached blobs are left in storage (harmless orphans),
 * only the DB pointer is cleared.
 *
 * RUN ONLY AFTER the pagination fix is deployed:
 *   railway run --service backend npx ts-node -T scripts/backfill-agreement-pdf-cache.ts
 * Pass --dry to see the count without writing.
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const prisma = new PrismaClient();
  try {
    const where = {
      signedAt: null,
      deletedAt: null,
      generatedPdfKey: { not: null },
    } as const;

    const count = await prisma.agreement.count({ where });
    console.log(
      `${count} unsigned agreement(s) have a cached PDF to refresh${dry ? ' (dry run — no writes)' : ''}.`,
    );

    if (!dry && count > 0) {
      const res = await prisma.agreement.updateMany({
        where,
        data: { generatedPdfKey: null, generatedPdfAt: null },
      });
      console.log(
        `cleared ${res.count} cached PDF pointer(s) — each regenerates with the new page layout on its next preview / pdf-url / send.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
