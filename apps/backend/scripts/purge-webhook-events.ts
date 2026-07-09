/**
 * One-time purge of the unbounded `whatsapp.webhook_events` backlog.
 *
 * The table had grown to ~363k rows / 490MB (42% of the whole database) with no
 * retention, making `INSERT INTO webhook_events` average 2.1s — the single
 * biggest consumer of DB time. WebhookEventRetentionService keeps it bounded
 * going forward (daily, capped), but it deliberately drains slowly; this script
 * clears the existing backlog now, in supervised batches.
 *
 * Safe: the rows are a raw-payload debug trail. The queue processor reads an
 * event back BY ID and stamps `processedAt`; nothing keys off it for
 * idempotency (no unique on `signature`), and no queue job survives the window.
 *
 * Usage (from apps/backend):
 *   railway run --service backend npx ts-node -T scripts/purge-webhook-events.ts --dry
 *   railway run --service backend npx ts-node -T scripts/purge-webhook-events.ts --days=30
 *
 * Flags: --dry (count only)  --days=N (retention window, default 30)
 *        --batch=N (rows per delete, default 5000)
 */
import { PrismaClient } from '@prisma/client';

const arg = (name: string, fallback: number): number => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split('=')[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const days = arg('days', 30);
  const batch = arg('batch', 5000);
  const prisma = new PrismaClient();

  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [total, doomed] = await Promise.all([
      prisma.whatsAppWebhookEvent.count(),
      prisma.whatsAppWebhookEvent.count({ where: { createdAt: { lt: cutoff } } }),
    ]);
    console.log(
      `webhook_events: ${total} rows total; ${doomed} older than ${days}d (cutoff ${cutoff.toISOString()})${dry ? ' — DRY RUN, no deletes' : ''}`,
    );
    if (dry || doomed === 0) return;

    let removed = 0;
    for (;;) {
      const rows = await prisma.whatsAppWebhookEvent.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: batch,
      });
      if (rows.length === 0) break;
      const res = await prisma.whatsAppWebhookEvent.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      removed += res.count;
      process.stdout.write(`  purged ${removed}/${doomed}\r`);
      if (rows.length < batch) break;
      // Breathe: the DB is already under load; don't turn this into a storm.
      await sleep(250);
    }
    console.log(`\npurged ${removed} event(s) older than ${days}d.`);

    // Reclaim space for reuse + refresh planner statistics (they were badly
    // stale: pg_stat_user_tables reported 1,392 live rows for a 363k table).
    console.log('running VACUUM (ANALYZE) on webhook_events…');
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) whatsapp.webhook_events');
    console.log('done.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
