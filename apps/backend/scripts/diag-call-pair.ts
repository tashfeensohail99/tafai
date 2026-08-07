/**
 * Compare recent calls from one phone number, side by side.
 *
 * Built for the controlled case: the same caller rang the same rep twice
 * minutes apart -- once with no audio in either direction, once fine. Same
 * handset, same network, same rep, so anything that differs between the two
 * rows is a live candidate for the dead-audio cause.
 *
 *   npx ts-node -T apps/backend/scripts/diag-call-pair.ts 3135678933 [howMany]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const digits = (process.argv[2] ?? '3135678933').replace(/\D/g, '');
const take = Number(process.argv[3] ?? 6);

function secs(a: Date | null, b: Date | null): string {
  if (!a || !b) return '—';
  return `${((b.getTime() - a.getTime()) / 1000).toFixed(1)}s`;
}

async function main() {
  const threads = await prisma.whatsAppThread.findMany({
    where: { waContactId: { contains: digits } },
    select: { id: true, waContactId: true },
  });
  if (!threads.length) {
    console.log(`No thread whose waContactId contains "${digits}".`);
    return;
  }
  console.log(`Threads matched: ${threads.map((t) => t.waContactId).join(', ')}\n`);

  const calls = await prisma.whatsAppCall.findMany({
    where: { threadId: { in: threads.map((t) => t.id) } },
    orderBy: { createdAt: 'desc' },
    take,
  });
  if (!calls.length) {
    console.log('No calls on those threads.');
    return;
  }

  for (const c of calls) {
    const audioOut = c.bytesSent ?? null;
    const audioIn = c.bytesReceived ?? null;
    // 3000 bytes ~= a couple of seconds of Opus; below that nothing useful flowed.
    const flowed = (n: number | null) => (n === null ? '?' : n > 3000 ? 'YES' : 'NO');
    console.log('─'.repeat(78));
    console.log(`${c.createdAt.toISOString()}   ${c.direction}   status=${c.status}`);
    console.log(`  callId            ${c.waCallId}`);
    console.log(`  ring -> answer    ${secs(c.startedAt, c.answeredAt)}`);
    console.log(`  talk time         ${c.durationSeconds ?? '—'}s   endReason=${c.endReason ?? '—'}`);
    console.log(
      `  AUDIO  rep->client ${String(audioOut ?? '—').padStart(9)} bytes  flowed=${flowed(audioOut)}`,
    );
    console.log(
      `         client->rep ${String(audioIn ?? '—').padStart(9)} bytes  flowed=${flowed(audioIn)}`,
    );
    console.log(
      `  path              ice=${c.iceCandidateType ?? '—'}  rtt=${c.rttMs ?? '—'}ms  ` +
        `jitter=${c.jitterMs ?? '—'}ms  loss=${c.packetLossPct ?? '—'}%`,
    );
    console.log(
      `  client            platform=${c.clientPlatform ?? '—'}  network=${c.networkType ?? '—'}`,
    );
    console.log(
      `  answered by       employee=${c.answeredByEmployeeId ?? '—'} user=${c.answeredByUserId ?? '—'}`,
    );
    console.log(
      `  sdp               offer=${c.sdpOffer ? `${c.sdpOffer.length}ch` : 'NONE'}  ` +
        `answer=${c.sdpAnswer ? `${c.sdpAnswer.length}ch` : 'NONE'}`,
    );
    console.log(`  heartbeat         last=${c.lastHeartbeatAt?.toISOString() ?? '—'}`);
    console.log(`  recording         ${c.recordingKey ? 'yes' : 'no'}`);
  }
  console.log('─'.repeat(78));
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
