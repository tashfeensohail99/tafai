/** READ-ONLY. Did the re-engagement blast actually send? Counts reengage_blast
 *  messages by delivery status + shows the most recent few (with any error). */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const where = { payload: { path: ['source'], equals: 'reengage_blast' } } as const;
  const total = await prisma.whatsAppMessage.count({ where });
  const grouped = await prisma.whatsAppMessage.groupBy({ by: ['status'], where, _count: { _all: true } });
  const recent = await prisma.whatsAppMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { createdAt: true, status: true, body: true, errorCode: true, waMessageId: true },
  });
  console.log(`reengage_blast messages: ${total}`);
  console.log('--- by status ---');
  for (const g of grouped) console.log(`  ${String(g._count._all).padStart(4)}  ${g.status}`);
  console.log('--- most recent ---');
  for (const m of recent) {
    const err = m.errorCode ? `  ERR ${m.errorCode}` : '';
    console.log(`  ${m.createdAt.toISOString()}  ${m.status}  wa=${m.waMessageId ? 'yes' : 'no'}  "${(m.body ?? '').slice(0, 40)}…"${err}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
