import type { PrismaService } from '../prisma/prisma.service';

/**
 * Find an existing (non-deleted) CLIENT whose phone is the same number as
 * `e164`, reconciling across the digit-string variants a phone gets stored in
 * (`+92 3xx…`, `03xx…`, `3xx…`, spaced, bare national).
 *
 * Mirror of `findLeadByNormalizedPhone` in ./lead-dedupe. Every automatic
 * lead-ingestion path (Meta ad webhook, WhatsApp inbound, public website
 * form, CSV import, processing bulk import) needs to check BOTH tables
 * before creating a new lead — a customer who converted to Client months
 * ago must not become a fresh Lead again just because their phone is
 * stored in a slightly different format on the two rows.
 *
 * Client.phone has a UNIQUE constraint (@unique) so the raw string is
 * already covered; this walk is what catches the local↔international
 * variants a UNIQUE(text) index can't reconcile.
 *
 * Returns the client's id AND its sourceLeadId — every client points back
 * at the lead it was converted from, so callers that want a Lead-shaped
 * target (e.g. the WhatsApp thread router) can pick up that lead directly
 * without opening a second one.
 */
export async function findClientByNormalizedPhone(
  prisma: PrismaService,
  e164: string,
): Promise<{ id: string; sourceLeadId: string | null; phone: string } | null> {
  const digits = String(e164 ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;

  const variants = new Set<string>([digits]);
  if (digits.startsWith('92') && digits.length === 12) {
    const national = digits.slice(2); // 3XXXXXXXXX
    variants.add(national);
    variants.add(`0${national}`);
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; sourceLeadId: string | null; phone: string }>
  >(
    `SELECT id, "sourceLeadId", phone
       FROM crm.clients
      WHERE "deletedAt" IS NULL
        AND phone !~ '[A-Za-z]'
        AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[])
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    [...variants],
  );
  return rows[0] ?? null;
}
