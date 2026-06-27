/** READ-ONLY probe: how is real payment revenue recorded, and how much of it
 *  is attributable to leads (client.sourceLeadId set)? Picks the right filter. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const num = (d: unknown) => (d == null ? 0 : Number(d as never));

async function main() {
  const byStatus = await prisma.payment.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { amount: true },
  });
  console.log('=== ALL payments by status (native amount) ===');
  for (const r of byStatus) console.log(`  ${r.status.padEnd(10)} n=${r._count._all}  amount=${Math.round(num(r._sum.amount)).toLocaleString()}`);

  const verifiedCount = await prisma.payment.count({ where: { verifiedAt: { not: null } } });
  const totalCount = await prisma.payment.count();
  console.log(`  verified (verifiedAt set): ${verifiedCount} / ${totalCount}`);

  // Lead-attributed payments (client came from a lead).
  const leadPays = await prisma.payment.findMany({
    where: { invoice: { client: { sourceLeadId: { not: null } } } },
    select: { amount: true, currency: true, status: true, verifiedAt: true },
  });
  const agg = new Map<string, { n: number; amt: number }>();
  for (const p of leadPays) {
    const key = `${p.currency} · ${p.status}${p.verifiedAt ? ' · verified' : ''}`;
    const g = agg.get(key) ?? { n: 0, amt: 0 };
    g.n += 1;
    g.amt += num(p.amount);
    agg.set(key, g);
  }
  console.log(`\n=== Lead-attributed payments: ${leadPays.length} total ===`);
  for (const [k, g] of [...agg.entries()].sort((a, b) => b[1].amt - a[1].amt)) {
    console.log(`  ${k}: n=${g.n}  amount=${Math.round(g.amt).toLocaleString()}`);
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
