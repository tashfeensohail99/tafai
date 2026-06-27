/** READ-ONLY. Runs the new /leads/stats aggregations against prod to verify the
 *  SQL executes and to surface the real numbers (revenue, speed-to-lead, lost). */
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const revenue = await prisma.$queryRaw<Array<{ cur: string; won: number; pipeline: number }>>(Prisma.sql`
    SELECT COALESCE(NULLIF(TRIM("serviceFeeCurrency"), ''), 'PKR') AS cur,
           COALESCE(SUM(CASE WHEN status = 'CONVERTED' THEN "serviceFeeAmount" END), 0)::float8 AS won,
           COALESCE(SUM(CASE WHEN status IN ('NEW','CONTACTED','QUALIFIED','PROPOSAL_SENT','FOLLOW_UP')
                        THEN "serviceFeeAmount" END), 0)::float8 AS pipeline
    FROM crm.leads WHERE "deletedAt" IS NULL AND "serviceFeeAmount" IS NOT NULL GROUP BY 1`);

  const lost = await prisma.$queryRaw<Array<{ reason: string; n: number }>>(Prisma.sql`
    SELECT COALESCE(NULLIF(TRIM("lostReason"), ''), 'Not specified') AS reason, count(*)::int AS n
    FROM crm.leads WHERE "deletedAt" IS NULL AND status = 'LOST' GROUP BY 1 ORDER BY n DESC LIMIT 8`);

  // HUMAN-only speed: first OUTBOUND message with a real employee (bot leaves sentByEmployeeId null).
  const speed = await prisma.$queryRaw<Array<{ median_min: number | null; sample: number; under5: number }>>(Prisma.sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (hr.first_human - t."firstInboundAt")) / 60.0)::float8 AS median_min,
           count(*)::int AS sample,
           SUM(CASE WHEN hr.first_human - t."firstInboundAt" <= interval '5 minutes' THEN 1 ELSE 0 END)::int AS under5
    FROM whatsapp.threads t JOIN crm.leads l ON l.id = t."leadId"
    JOIN LATERAL (
      SELECT min(m."createdAt") AS first_human FROM whatsapp.messages m
      WHERE m."threadId" = t.id AND m.direction = 'OUTBOUND' AND m."sentByEmployeeId" IS NOT NULL
    ) hr ON true
    WHERE l."deletedAt" IS NULL AND t."firstInboundAt" IS NOT NULL
      AND hr.first_human IS NOT NULL AND hr.first_human >= t."firstInboundAt"
      AND t."firstInboundAt" >= now() - interval '30 days'`);

  // Real cash: verified payments (PAID/PARTIAL) for clients that came from a lead.
  const received = await prisma.payment.findMany({
    where: { status: { in: ['PAID', 'PARTIAL'] }, invoice: { client: { sourceLeadId: { not: null } } } },
    select: { amount: true, currency: true },
  });
  const recvByCur = new Map<string, number>();
  for (const p of received) recvByCur.set(p.currency || 'CAD', (recvByCur.get(p.currency || 'CAD') ?? 0) + Number(p.amount));

  console.log('=== Cash collected (verified payments, lead clients) ===');
  if (recvByCur.size === 0) console.log('  (none)');
  for (const [cur, amt] of recvByCur) console.log(`  ${cur}: ${Math.round(amt).toLocaleString()}`);
  console.log('=== Revenue agreed-fee (by currency) ===');
  for (const r of revenue) console.log(`  ${r.cur}: won=${Math.round(r.won).toLocaleString()}  pipeline=${Math.round(r.pipeline).toLocaleString()}`);
  console.log('=== Speed-to-lead (30d) ===');
  const s = speed[0];
  console.log(`  median=${s?.median_min != null ? Math.round(s.median_min) + ' min' : 'n/a'}  sample=${s?.sample ?? 0}  under5min=${s?.sample ? Math.round((Number(s.under5)/Number(s.sample))*100) : 0}%`);
  console.log('=== Top lost reasons ===');
  if (lost.length === 0) console.log('  (none)');
  for (const r of lost) console.log(`  ${String(r.n).padStart(4)}  ${r.reason}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
