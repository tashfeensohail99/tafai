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
 * Concurrency: each candidate code is checked against the @unique
 * constraint via findUnique. If it collides (race with another
 * concurrent write), the retry loop bumps the suffix and re-tries.
 * Bounded to 6 attempts; the last-ditch fallback adds a timestamp
 * suffix so a write never fails outright.
 */

export async function generateLeadReferenceCode(
  prisma: PrismaService,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const count = await prisma.lead.count({
      where: { createdAt: { gte: yearStart, lt: yearEnd } },
    });
    const candidate = `TIS-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
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
