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
    // Legacy malformed form "+92"+local-with-0 (= "920"+national, 13 digits),
    // written by the WhatsApp webhook before it normalised inbound phones. Match
    // it so a clean inbound reconciles to (and self-heals) the malformed lead
    // instead of spawning yet another duplicate.
    variants.add(`920${national}`);
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
    // Canonicalise the stored phone so future lookups hit the fast exact-string
    // index — but ONLY if no other live lead already holds this E.164, otherwise
    // the rewrite would silently manufacture a duplicate on the same number
    // (Lead.phone is indexed, not unique). That collision case (e.g. a malformed
    // lead older than its clean twin) is left untouched for the backfill's
    // manual-merge queue. Best-effort; a failure here never breaks resolution.
    const clash = await prisma.lead
      .count({ where: { phone: e164, deletedAt: null, id: { not: row.id } } })
      .catch(() => 1);
    if (clash === 0) {
      await prisma.lead
        .update({ where: { id: row.id }, data: { phone: e164 } })
        .catch(() => undefined);
    }
  }
  return { id: row.id, assignedEmployeeId: row.assignedEmployeeId, blockedAt: row.blockedAt };
}

/**
 * Client counterpart of {@link findLeadByNormalizedPhone}. The WhatsApp webhook
 * resolves a contact as client > lead; the client step was an exact-string match
 * only, so a client stored in a non-canonical shape (e.g. a legacy malformed
 * "+9203…" inherited from a converted lead) would be MISSED once inbound phones
 * are canonicalised — silently dropping block enforcement and spawning a
 * duplicate lead for an existing client. This reconciles across the same digit
 * variants so the client is still found.
 *
 * Client.phone is @unique, so the self-heal rewrites to the canonical E.164 only
 * when no other live client already holds it (else the update would hit the
 * unique constraint) — a collision is left for manual merge. Best-effort.
 */
export async function findClientByNormalizedPhone(
  prisma: PrismaService,
  e164: string,
): Promise<{ id: string; blockedAt: Date | null } | null> {
  const digits = String(e164 ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;

  const variants = new Set<string>([digits]);
  if (digits.startsWith('92') && digits.length === 12) {
    const national = digits.slice(2);
    variants.add(national);
    variants.add(`0${national}`);
    variants.add(`920${national}`); // legacy "+92"+local-with-0 malformed form
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; blockedAt: Date | null; phone: string }>>(
    `SELECT id, "blockedAt", phone
     FROM crm.clients
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
    const clash = await prisma.client
      .count({ where: { phone: e164, deletedAt: null, id: { not: row.id } } })
      .catch(() => 1);
    if (clash === 0) {
      await prisma.client
        .update({ where: { id: row.id }, data: { phone: e164 } })
        .catch(() => undefined);
    }
  }
  return { id: row.id, blockedAt: row.blockedAt };
}
