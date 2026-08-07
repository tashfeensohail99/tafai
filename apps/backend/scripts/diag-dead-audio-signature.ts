/**
 * Do all "dead audio" calls share one signature?
 *
 * A dead call is an answered call where a CDR came back but no RTP flowed in
 * either direction. The question that matters: was ICE healthy at the time?
 * If RTT was measured, STUN connectivity checks were succeeding, so the network
 * path existed and the failure is above it (DTLS/SRTP or the media pipeline) --
 * not something more TURN or a bigger server would fix.
 *
 *   npx ts-node -T apps/backend/scripts/diag-dead-audio-signature.ts [days]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const days = Number(process.argv[2] ?? 30);

const AUDIO_FLOOR = 3000; // ~2s of Opus; below this nothing useful was carried

function pct(n: number, total: number) {
  return total ? `${Math.round((n / total) * 100)}%` : '—';
}

function tally(rows: (string | null)[], label: string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r ?? '(null)', (m.get(r ?? '(null)') ?? 0) + 1);
  console.log(`  ${label}`);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${k.padEnd(16)} ${String(v).padStart(4)}  (${pct(v, rows.length)})`);
  }
}

async function main() {
  const since = new Date(Date.now() - days * 86400000);
  // Only calls that reported a CDR at all -- otherwise we cannot distinguish
  // "no audio" from "client never told us anything".
  const calls = await prisma.whatsAppCall.findMany({
    where: { createdAt: { gte: since }, answeredAt: { not: null }, bytesSent: { not: null } },
    select: {
      bytesSent: true, bytesReceived: true, rttMs: true, jitterMs: true, packetLossPct: true,
      iceCandidateType: true, networkType: true, clientPlatform: true, endReason: true,
      status: true, lastHeartbeatAt: true, recordingKey: true, durationSeconds: true,
    },
  });

  const dead = calls.filter(
    (c) => (c.bytesSent ?? 0) <= AUDIO_FLOOR && (c.bytesReceived ?? 0) <= AUDIO_FLOOR,
  );
  const ok = calls.filter(
    (c) => (c.bytesSent ?? 0) > AUDIO_FLOOR && (c.bytesReceived ?? 0) > AUDIO_FLOOR,
  );

  console.log(`Answered calls with a CDR (${days}d): ${calls.length}`);
  console.log(`  audio both ways : ${ok.length}  (${pct(ok.length, calls.length)})`);
  console.log(`  DEAD both ways  : ${dead.length}  (${pct(dead.length, calls.length)})\n`);
  if (!dead.length) return;

  // THE question: was the network path up when the audio was dead?
  const deadWithRtt = dead.filter((c) => c.rttMs != null);
  console.log('=== Was ICE healthy on the DEAD calls? ===');
  console.log(
    `  reported an RTT (STUN checks were passing): ${deadWithRtt.length}/${dead.length}` +
      `  (${pct(deadWithRtt.length, dead.length)})`,
  );
  if (deadWithRtt.length) {
    const rtts = deadWithRtt.map((c) => c.rttMs!).sort((a, b) => a - b);
    console.log(
      `  their RTT: min ${rtts[0]}ms  median ${rtts[Math.floor(rtts.length / 2)]}ms  max ${rtts[rtts.length - 1]}ms`,
    );
    console.log('  -> a healthy RTT with zero bytes means the PATH was fine and media still died.');
  }

  console.log('\n=== DEAD calls ===');
  tally(dead.map((c) => c.iceCandidateType), 'ICE path:');
  tally(dead.map((c) => c.networkType), 'network:');
  tally(dead.map((c) => c.clientPlatform), 'platform:');
  tally(dead.map((c) => c.endReason), 'end reason:');
  tally(dead.map((c) => c.status), 'final status:');
  const noHb = dead.filter((c) => !c.lastHeartbeatAt).length;
  const noRec = dead.filter((c) => !c.recordingKey).length;
  console.log(`  no heartbeat ever: ${noHb}/${dead.length} (${pct(noHb, dead.length)})`);
  console.log(`  no recording:      ${noRec}/${dead.length} (${pct(noRec, dead.length)})`);

  console.log('\n=== HEALTHY calls (for contrast) ===');
  tally(ok.map((c) => c.iceCandidateType), 'ICE path:');
  tally(ok.map((c) => c.networkType), 'network:');
  const okNoHb = ok.filter((c) => !c.lastHeartbeatAt).length;
  console.log(`  no heartbeat ever: ${okNoHb}/${ok.length} (${pct(okNoHb, ok.length)})`);

  // If ICE path distribution is identical across dead/healthy, the candidate
  // type is NOT the discriminator and the ICE fast-path change is not implicated.
  console.log(
    '\n  If the ICE path split looks the same on both, candidate selection is not the cause.',
  );
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
