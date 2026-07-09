import type { PrismaService } from '../prisma/prisma.service';

/**
 * Find an existing (non-deleted) lead that is the SAME phone number as `e164`,
 * reconciling across the formats a lead may be stored in (local "03xx…",
 * "+92 3xx…", spaced, bare national). Leads are created by many channels with
 * inconsistent phone formats, so an exact-string match silently misses the same
 * person and every channel re-creates the lead — which then lands with a
 * different (often random) owner, splitting the customer across reps.
 *
 * Matching is on the exact DIGIT-STRING VARIANTS of the number, NOT a bare
 * last-10 tail: for a PK number "+923004992547" the legitimate stored forms are
 * "923004992547" (E.164), "3004992547" (national) and "03004992547" (local with
 * trunk 0). This bridges local↔intl WITHOUT the cross-country false-positives a
 * last-10 tail causes. Non-dialable placeholder phones ("meta-<id>",
 * "MANUAL-<ref>" — they contain letters) are excluded so their long numeric
 * tail can never false-match a real caller (which would mis-route them, or —
 * if the placeholder is blocked — silently drop a legitimate inbound).
 *
 * Clients are NOT matched here (Client.phone is unique/canonical — callers match
 * clients by exact E.164 first, client wins). Returns the OLDEST matching lead so
 * the ORIGINAL owner wins when a number was already (wrongly) duplicated.
 *
 * Side-effect (self-heal): on a match whose stored phone differs from `e164`, the
 * lead's phone is canonicalised to `e164` so subsequent lookups hit the fast
 * exact-string index instead of re-running this scan. Best-effort; a failure
 * here never breaks resolution.
 *
 * NOTE: the match predicate is served by the expression index
 * `leads_phone_digits_idx` — CREATE INDEX ON crm.leads
 * ((regexp_replace(phone,'[^0-9]','','g'))) WHERE "deletedAt" IS NULL — added in
 * migration 20260709120000. Keep the predicate here byte-identical to that
 * index expression or Postgres silently falls back to a ~21s Seq Scan over
 * every live lead (this ran on the WhatsApp webhook hot path and was ~11% of
 * all DB CPU).
 */
export async function findLeadByNormalizedPhone(
  prisma: PrismaService,
  e164: string,
): Promise<{ id: string; assignedEmployeeId: string | null; blockedAt: Date | null } | null> {
  const digits = String(e164 ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;

  // The exact digit-string forms this SAME number could be stored as.
  const variants = new Set<string>([digits]);
  if (digits.startsWith('92') && digits.length === 12) {
    const national = digits.slice(2); // 3XXXXXXXXX
    variants.add(national); // bare national
    variants.add(`0${national}`); // local with trunk 0
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; assignedEmployeeId: string | null; blockedAt: Date | null; phone: string }>
  >(
    `SELECT id, "assignedEmployeeId", "blockedAt", phone
     FROM crm.leads
     WHERE "deletedAt" IS NULL
       AND phone !~ '[A-Za-z]'
       AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[])
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [...variants],
  );
  const row = rows[0];
  if (!row) return null;

  if (row.phone !== e164) {
    await prisma.lead
      .update({ where: { id: row.id }, data: { phone: e164 } })
      .catch(() => undefined);
  }
  return { id: row.id, assignedEmployeeId: row.assignedEmployeeId, blockedAt: row.blockedAt };
}
