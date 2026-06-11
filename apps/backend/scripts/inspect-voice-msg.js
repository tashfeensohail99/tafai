/**
 * Read-only: dump the most recent outbound messages for a phone number,
 * with status + any Meta error captured in payload. Diagnoses voice-note
 * "failed" reports. Usage:
 *   railway run --service backend -- node scripts/inspect-voice-msg.js 923135678933
 */
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}
const { PrismaClient } = require('@prisma/client');

async function main() {
  const raw = process.argv[2] || '';
  const digits = raw.replace(/\D/g, '');
  const prisma = new PrismaClient();

  // Thread keys on waContactId = E.164 without leading +.
  const threads = await prisma.whatsAppThread.findMany({
    where: { waContactId: { contains: digits.slice(-10) } },
    select: {
      id: true, waContactId: true, windowExpiresAt: true,
      lead: { select: { firstName: true, lastName: true } },
      client: { select: { firstName: true, lastName: true } },
    },
    take: 5,
  });
  console.log('THREADS:', JSON.stringify(threads, null, 2));

  for (const t of threads) {
    const who = t.client ?? t.lead;
    const name = who ? `${who.firstName ?? ''} ${who.lastName ?? ''}`.trim() : '?';
    const msgs = await prisma.whatsAppMessage.findMany({
      where: { threadId: t.id, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true, type: true, status: true, createdAt: true,
        mediaMimeType: true, mediaUrl: true, waMessageId: true,
        sentByEmployeeId: true,
        errorCode: true, errorTitle: true, errorDetails: true,
      },
    });
    console.log(`\n=== OUTBOUND for ${t.waContactId} (${name}) ===`);
    for (const m of msgs) {
      const ref = (m.mediaUrl ?? '').slice(0, 28);
      console.log(
        `${m.createdAt.toISOString()} | ${m.type} | ${m.status} | mime=${m.mediaMimeType ?? '-'} | ref=${ref} | by=${m.sentByEmployeeId ? 'emp' : 'none'}` +
        (m.errorCode ? `\n    META ${m.errorCode}: ${JSON.stringify(m.errorDetails)}` : ''),
      );
    }
    console.log(`window: ${t.windowExpiresAt ? t.windowExpiresAt.toISOString() : 'CLOSED/none'} (now ${new Date().toISOString()})`);
  }
  await prisma.$disconnect();
}
void main();
