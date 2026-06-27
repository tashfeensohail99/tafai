/** READ-ONLY: confirm the leads-dashboard ad-spend numbers + per-ad join. */
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const win = new Date(Date.now() - 30 * 864e5);
  const byCur = await prisma.adSpendDaily.groupBy({ by: ['currency'], where: { date: { gte: win } }, _sum: { spend: true, baseSpend: true } });
  let baseCad = 0;
  const adSpend = byCur.map((s) => {
    baseCad += Number(s._sum.baseSpend ?? 0);
    return `${s.currency} ${Math.round(Number(s._sum.spend ?? 0)).toLocaleString()}`;
  });

  // 30-day cohort (matches the windowed dashboard metrics).
  const fromAds =
    (await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(DISTINCT l.id)::int AS n FROM crm.leads l
      JOIN whatsapp.threads t ON t."leadId" = l.id
      WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL
        AND COALESCE(t."adReferralAt", l."createdAt") >= now() - interval '30 days'`))[0]?.n ?? 0;

  const rev =
    (await prisma.$queryRaw<Array<{ revenue_base: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(r.rev_base),0)::float8 AS revenue_base FROM (
        SELECT DISTINCT ON (l.id) l.id AS lead_id FROM crm.leads l
        JOIN whatsapp.threads t ON t."leadId" = l.id
        WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL
          AND COALESCE(t."adReferralAt", l."createdAt") >= now() - interval '30 days'
      ) led JOIN LATERAL (
        SELECT COALESCE(SUM(p."baseAmount"),0) AS rev_base
        FROM crm.clients c JOIN finance.invoices i ON i."clientId"=c.id
        JOIN finance.payments p ON p."invoiceId"=i.id
        WHERE c."sourceLeadId"=led.lead_id AND p.status IN ('PAID','PARTIAL')
      ) r ON true`))[0]?.revenue_base ?? 0;

  const spendAds = await prisma.adSpendDaily.findMany({ select: { adId: true }, distinct: ['adId'] });
  const adIds = new Set(spendAds.map((s) => s.adId));
  const grpRows = await prisma.$queryRaw<Array<{ grp: string; leads: number }>>(Prisma.sql`
    SELECT COALESCE(t."adReferral"->>'source_id', t."adReferral"->>'headline','unknown') AS grp,
           count(DISTINCT l.id)::int AS leads
    FROM crm.leads l JOIN whatsapp.threads t ON t."leadId"=l.id
    WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL GROUP BY 1`);
  const matched = grpRows.filter((g) => adIds.has(g.grp));

  console.log('Ad spend (native):', adSpend.join(' + '), '| base CAD', Math.round(baseCad));
  console.log('Ad-sourced leads:', fromAds, '| revenue from them (CAD):', Math.round(rev));
  console.log('Blended CPL (CAD/lead):', fromAds ? Math.round((baseCad / fromAds) * 100) / 100 : null,
    '| Blended ROAS:', baseCad ? Math.round((rev / baseCad) * 100) / 100 : null);
  console.log(`Distinct ad_ids with spend: ${adIds.size} | leaderboard ad-groups matching a spend ad_id: ${matched.length}/${grpRows.length}`);
  if (matched.length) console.log('  matched ad_ids (lead counts):', matched.map((m) => `${m.grp}:${m.leads}`).join(', ').slice(0, 300));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
