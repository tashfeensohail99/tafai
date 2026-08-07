/**
 * Backfill durable Meta ad attribution onto existing CTWA leads.
 *
 * New leads get stamped at creation (webhook-ingest / meta-leads). This fills in
 * the ~23k historical leads whose ad currently lives only on the WhatsApp
 * thread's adReferral JSON — copying the ad id (and best-effort ad name /
 * campaign from the spend cache) onto the lead so attribution survives even if
 * the thread is later detached by conversion.
 *
 * One UPDATE ... FROM (pool-safe, not a per-row fan-out). Idempotent: only
 * touches leads whose metaAdId is still NULL, so re-running is safe.
 *
 *   DRY RUN (default): ... backfill-lead-meta-attribution.ts
 *   EXECUTE:           ... backfill-lead-meta-attribution.ts --apply
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const eligible = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`
    SELECT COUNT(*)::bigint AS n
    FROM crm.leads l
    JOIN whatsapp.threads t ON t."leadId" = l.id
    WHERE t."adReferral" IS NOT NULL
      AND t."adReferral"->>'source_id' IS NOT NULL
      AND l."metaAdId" IS NULL
  `);
  const count = Number(eligible[0]?.n ?? 0);
  console.log(`Leads with thread ad attribution but no metaAdId yet: ${count}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to backfill.');
    return;
  }

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE crm.leads l
    SET "metaSource"       = 'ctwa',
        "metaAdId"         = t."adReferral"->>'source_id',
        "ctwaClid"         = t."adReferral"->>'ctwa_clid',
        "metaAdName"       = s."adName",
        "metaCampaignId"   = s."campaignId",
        "metaCampaignName" = s."campaignName"
    FROM whatsapp.threads t
    LEFT JOIN LATERAL (
      SELECT "adName", "campaignId", "campaignName"
      FROM crm.ad_spend_daily d
      WHERE d."adId" = t."adReferral"->>'source_id'
      ORDER BY d.date DESC
      LIMIT 1
    ) s ON true
    WHERE t."leadId" = l.id
      AND t."adReferral" IS NOT NULL
      AND t."adReferral"->>'source_id' IS NOT NULL
      AND l."metaAdId" IS NULL
  `);
  console.log(`\nAPPLIED — leads stamped: ${updated}`);

  const withCampaign = await prisma.lead.count({
    where: { metaSource: 'ctwa', metaCampaignId: { not: null } },
  });
  const total = await prisma.lead.count({ where: { metaAdId: { not: null } } });
  console.log(`Leads now carrying a metaAdId: ${total}  (of which ${withCampaign} also resolved a campaign from the spend cache)`);
  console.log('Ad id is the durable datum; ad-name/campaign for the rest resolve once the hierarchy sync (1C) lands.');
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
