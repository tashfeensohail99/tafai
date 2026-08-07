/**
 * Does the dead-audio failure track how LONG the rep took to answer?
 *
 * Motivation: pre-accept warms the media session during the ring. RFC 7675 ICE
 * consent freshness kills an idle session after ~5-6s, and a live incident on
 * 2026-07-07 showed a stale warmed session drops the call the moment it is
 * answered. If dead calls skew toward slower answers, that mechanism is a prime
 * suspect -- and it would mean pre-accept is enabled in production.
 *
 *   npx ts-node -T apps/backend/scripts/diag-dead-audio-ringtime.ts [days]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const days = Number(process.argv[2] ?? 30);
const AUDIO_FLOOR = 3000;

function pctl(xs: number[], p: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function describe(label: string, xs: number[]) {
  if (!xs.length) return console.log(`  ${label.padEnd(9)} (none)`);
  console.log(
    `  ${label.padEnd(9)} n=${String(xs.length).padStart(4)}  ` +
      `p25=${pctl(xs, 0.25).toFixed(1)}s  median=${pctl(xs, 0.5).toFixed(1)}s  ` +
      `p75=${pctl(xs, 0.75).toFixed(1)}s  p90=${pctl(xs, 0.9).toFixed(1)}s`,
  );
}

async function main() {
  const since = new Date(Date.now() - days * 86400000);
  const calls = await prisma.whatsAppCall.findMany({
    where: {
      createdAt: { gte: since },
      answeredAt: { not: null },
      startedAt: { not: null },
      bytesSent: { not: null },
    },
    select: { bytesSent: true, bytesReceived: true, startedAt: true, answeredAt: true },
  });

  const ring = (c: (typeof calls)[number]) =>
    (c.answeredAt!.getTime() - c.startedAt!.getTime()) / 1000;
  const isDead = (c: (typeof calls)[number]) =>
    (c.bytesSent ?? 0) <= AUDIO_FLOOR && (c.bytesReceived ?? 0) <= AUDIO_FLOOR;

  // Negative/absurd values mean the timestamps were written out of order.
  const usable = calls.filter((c) => ring(c) >= 0 && ring(c) < 300);
  const dead = usable.filter(isDead);
  const ok = usable.filter((c) => !isDead(c));

  console.log(`Answered calls with a CDR + ring timing (${days}d): ${usable.length}\n`);
  console.log('=== Ring -> answer, dead vs healthy ===');
  describe('DEAD', dead.map(ring));
  describe('HEALTHY', ok.map(ring));

  // The consent-freshness window the 2026-07-07 incident pointed at.
  console.log('\n=== Dead rate bucketed by how long the rep took to answer ===');
  const buckets: Array<[string, (r: number) => boolean]> = [
    ['0-5s', (r) => r < 5],
    ['5-10s', (r) => r >= 5 && r < 10],
    ['10-20s', (r) => r >= 10 && r < 20],
    ['20-40s', (r) => r >= 20 && r < 40],
    ['40s+', (r) => r >= 40],
  ];
  for (const [label, test] of buckets) {
    const inB = usable.filter((c) => test(ring(c)));
    const deadN = inB.filter(isDead).length;
    const rate = inB.length ? Math.round((deadN / inB.length) * 100) : 0;
    const bar = '#'.repeat(Math.round(rate / 2));
    console.log(
      `  ${label.padEnd(7)} ${String(deadN).padStart(3)}/${String(inB.length).padEnd(4)} dead  ` +
        `${String(rate).padStart(3)}%  ${bar}`,
    );
  }
  console.log(
    '\n  A flat rate across buckets clears the consent-freshness theory;\n' +
      '  a rate climbing with answer delay would confirm it.',
  );
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
