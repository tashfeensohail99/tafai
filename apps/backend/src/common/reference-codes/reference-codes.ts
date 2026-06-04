import type { PrismaService } from '../prisma/prisma.service';

/**
 * Shared helpers for generating year-scoped sequential reference codes.
 *
 * Format: TIS-YYYY-NNNNN (Tashfeen Immigration Solutions, year, 5-digit
 * sequence). Lead and Client codes share the same shape and uniqueness
 * domain (each is unique within its own table), and a Lead's code is
 * COPIED onto its Client on conversion so the customer carries one
 * identifier from first contact through every invoice / receipt / case.
 *
 * Why two separate generators (lead vs orphan-client):
 *   - 99% of clients get their code from the lead they were converted
 *     from (leads.service.convertToClient copies it).
 *   - The remaining ~1% (a client created directly, no lead history)
 *     starts at TIS-YYYY-01000 within the year so their codes don't
 *     visually collide with the bulk of lead-derived clients.
 *
 * Concurrency: the sequence number comes from an ATOMIC counter
 * (finance.document_sequences, series 'LEAD') via a single
 * INSERT … ON CONFLICT … RETURNING — the same race-safe mechanism the
 * NumberingService uses for invoices. Two concurrent callers therefore get
 * DIFFERENT numbers regardless of when their rows commit, which the old
 * COUNT(*)-based generator did not guarantee (concurrent CSV imports racing
 * live inbound leads computed the same count and collided on insert). The
 * counter is seeded per year from the existing max by the
 * 20260604120000_seed_lead_reference_sequence migration.
 *
 * The findUnique check + re-increment loop only matters during the brief
 * rolling-deploy window (an old container may still mint a count-based code);
 * in steady state it returns on the first attempt with one indexed lookup —
 * far cheaper than the previous full-year COUNT(*) on every insert.
 */

async function nextSequence(prisma: PrismaService, series: string, year: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "finance"."document_sequences" ("series", "year", "lastValue")
    VALUES (${series}, ${year}, 1)
    ON CONFLICT ("series", "year")
    DO UPDATE SET "lastValue" = "finance"."document_sequences"."lastValue" + 1
    RETURNING "lastValue"`;
  return Number(rows[0].lastValue);
}

export async function generateLeadReferenceCode(
  prisma: PrismaService,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const n = await nextSequence(prisma, 'LEAD', year);
    const candidate = `TIS-${year}-${String(n).padStart(5, '0')}`;
    const existing = await prisma.lead.findUnique({
      where: { referenceCode: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `TIS-${year}-${String(Date.now()).slice(-6)}`;
}

/**
 * Reference code for a Client created directly (not converted from a
 * lead). Starts at TIS-YYYY-01000 within the year.
 */
export async function generateOrphanClientReferenceCode(
  prisma: PrismaService,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const count = await prisma.client.count({
      where: { createdAt: { gte: yearStart, lt: yearEnd } },
    });
    const candidate = `TIS-${year}-${String(1000 + count + 1 + attempt).padStart(5, '0')}`;
    const existing = await prisma.client.findUnique({
      where: { referenceCode: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `TIS-${year}-${String(Date.now()).slice(-6)}`;
}
