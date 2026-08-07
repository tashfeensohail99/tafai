/**
 * Is "no heartbeat" a CAUSE of dead audio, or just a CONSEQUENCE of hanging up
 * fast when you hear nothing?
 *
 * The heartbeat fires roughly every 15s while a call is connected. A dead call
 * gets abandoned in a few seconds -- so of course it has no heartbeat. That
 * makes "no heartbeat" a proxy for "short call" unless we can find dead calls
 * that ran LONG ENOUGH to have sent one and still didn't.
 *
 *   npx ts-node -T apps/backend/scripts/diag-dead-audio-duration.ts [days]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const days = Number(process.argv[2] ?? 30);
const AUDIO_FLOOR = 3000;
const HEARTBEAT_PERIOD = 15; // seconds

function stats(xs: number[]) {
  if (!xs.length) return 'none';
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return `n=${s.length}  p10=${q(0.1)}s  median=${q(0.5)}s  p90=${q(0.9)}s  max=${s[s.length - 1]}s`;
}

async function main() {
  const since = new Date(Date.now() - days * 86400000);
  const calls = await prisma.whatsAppCall.findMany({
    where: { createdAt: { gte: since }, answeredAt: { not: null }, bytesSent: { not: null } },
    select: {
      bytesSent: true, bytesReceived: true, durationSeconds: true, lastHeartbeatAt: true,
      answeredAt: true, endedAt: true, status: true, endReason: true, rttMs: true,
    },
  });

  const isDead = (c: (typeof calls)[number]) =>
    (c.bytesSent ?? 0) <= AUDIO_FLOOR && (c.bytesReceived ?? 0) <= AUDIO_FLOOR;

  // durationSeconds is sometimes null even when we know answeredAt/endedAt.
  const dur = (c: (typeof calls)[number]): number | null => {
    if (c.durationSeconds != null) return c.durationSeconds;
    if (c.answeredAt && c.endedAt)
      return Math.round((c.endedAt.getTime() - c.answeredAt.getTime()) / 1000);
    return null;
  };

  const dead = calls.filter(isDead);
  const ok = calls.filter((c) => !isDead(c));

  console.log(`Answered calls with a CDR (${days}d): ${calls.length}\n`);
  console.log('=== How long did they last? ===');
  console.log(`  DEAD    ${stats(dead.map(dur).filter((d): d is number => d != null))}`);
  console.log(`  HEALTHY ${stats(ok.map(dur).filter((d): d is number => d != null))}`);
  console.log(`  DEAD with unknown duration: ${dead.filter((c) => dur(c) == null).length}/${dead.length}`);

  // THE disambiguation: dead calls that lasted long enough to owe us a heartbeat.
  const longDead = dead.filter((c) => (dur(c) ?? 0) >= HEARTBEAT_PERIOD * 2);
  const longDeadNoHb = longDead.filter((c) => !c.lastHeartbeatAt);
  console.log(`\n=== Dead calls that ran >= ${HEARTBEAT_PERIOD * 2}s (should have sent a heartbeat) ===`);
  console.log(`  count: ${longDead.length}`);
  console.log(`  ...of which sent NO heartbeat: ${longDeadNoHb.length}`);
  if (longDead.length === 0) {
    console.log('  -> No long dead calls at all. "No heartbeat" is therefore just a');
    console.log('     restatement of "the call was short", NOT an independent cause.');
    console.log('     People hang up within seconds when they hear silence.');
  } else if (longDeadNoHb.length === longDead.length) {
    console.log('  -> Every long dead call also failed to heartbeat. The client-side call');
    console.log('     loop was genuinely not running -- a real signal, not an artefact.');
  } else {
    console.log('  -> Mixed: heartbeat absence does not fully track dead audio.');
  }

  // Same control on the healthy side: short healthy calls should also lack heartbeats.
  const shortOk = ok.filter((c) => (dur(c) ?? 0) < HEARTBEAT_PERIOD);
  const shortOkNoHb = shortOk.filter((c) => !c.lastHeartbeatAt).length;
  console.log(`\n=== Control: HEALTHY calls shorter than ${HEARTBEAT_PERIOD}s ===`);
  console.log(`  count ${shortOk.length}, of which no heartbeat: ${shortOkNoHb} (${
    shortOk.length ? Math.round((shortOkNoHb / shortOk.length) * 100) : 0
  }%)`);
  console.log('  -> If this is also ~100%, heartbeat absence is purely a duration artefact.');

  console.log('\n=== Dead-call end states ===');
  const m = new Map<string, number>();
  for (const c of dead) {
    const k = `${c.status}/${c.endReason ?? 'no-reason'}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${v}`);
  }
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
