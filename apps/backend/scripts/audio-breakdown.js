/**
 * Compare delivered vs failed OUTBOUND audio: recency, source (employee vs
 * bot/null), voice-note flag, recipient. Pinpoints what separates the working
 * voice notes from the failing ones. Read-only.
 */
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}
const { PrismaClient } = require('@prisma/client');

function row(m) {
  const vn = m.payload && m.payload.isVoiceNote ? 'VOICE' : 'audio';
  const ref = (m.mediaUrl || '').split(':')[0].slice(0, 10);
  return `  ${m.createdAt.toISOString()} | ${m.status} | ${vn} | ref=${ref} | by=${m.sentByEmployeeId ? 'emp' : 'BOT/none'}`;
}

async function main() {
  const prisma = new PrismaClient();
  const sel = {
    createdAt: true, status: true, mediaUrl: true, payload: true, sentByEmployeeId: true,
  };
  const delivered = await prisma.whatsAppMessage.findMany({
    where: { type: 'AUDIO', direction: 'OUTBOUND', status: { in: ['DELIVERED', 'READ', 'SENT'] } },
    orderBy: { createdAt: 'desc' }, take: 8, select: sel,
  });
  const failed = await prisma.whatsAppMessage.findMany({
    where: { type: 'AUDIO', direction: 'OUTBOUND', status: 'FAILED' },
    orderBy: { createdAt: 'desc' }, take: 8, select: sel,
  });
  console.log('=== RECENT DELIVERED/SENT AUDIO ===');
  delivered.forEach((m) => console.log(row(m)));
  console.log('=== RECENT FAILED AUDIO ===');
  failed.forEach((m) => console.log(row(m)));
  await prisma.$disconnect();
}
void main();
