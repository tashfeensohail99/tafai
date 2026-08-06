/**
 * Fleet version report — who is on which app build, and which Shorebird patch
 * actually landed on their phone.
 *
 * The mobile app writes a fingerprint into DeviceToken.deviceInfo on every
 * start (see apps/mobile/lib/core/device/device_report.dart):
 *
 *     v1.0.42+44 · patch 3 · Redmi Note 12 · Android 14
 *
 * Devices showing "(not reporting)" are on a build from before that shipped —
 * they are on an OLD version by definition, which is itself the answer.
 *
 *   npx ts-node -T apps/backend/scripts/diag-app-versions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NOT_REPORTING = '(not reporting)';

/** `v1.0.42+44 · patch 3 · Redmi Note 12 · Android 14` → its parts. */
function parse(info: string | null) {
  if (!info) return { build: NOT_REPORTING, patch: NOT_REPORTING, device: '' };
  const build = /^v(\S+)/.exec(info)?.[1];
  const patch = /patch (\d+|none|n\/a|\?)/.exec(info)?.[1];
  const device = info
    .split(' · ')
    .slice(2)
    .join(' · ');
  return {
    build: build ? `v${build}` : NOT_REPORTING,
    patch: patch ?? NOT_REPORTING,
    device,
  };
}

/** Sorts `v1.0.42+44` by its build number, newest first. */
function buildRank(build: string): number {
  return Number(/\+(\d+)/.exec(build)?.[1] ?? -1);
}

function tally(rows: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const tokens = await prisma.deviceToken.findMany({
    orderBy: { lastSeenAt: 'desc' },
    select: { userId: true, deviceInfo: true, lastSeenAt: true },
  });
  if (!tokens.length) {
    console.log('No devices registered.');
    return;
  }

  const users = await prisma.userAccount.findMany({
    where: { id: { in: [...new Set(tokens.map((t) => t.userId))] } },
    select: {
      id: true,
      email: true,
      employee: { select: { firstName: true, lastName: true } },
    },
  });
  const who = new Map(
    users.map((u) => [
      u.id,
      u.employee
        ? `${u.employee.firstName} ${u.employee.lastName ?? ''}`.trim()
        : u.email,
    ]),
  );

  const now = Date.now();
  const daysAgo = (d: Date) => Math.round((now - d.getTime()) / 86400000);
  const rows = tokens.map((t) => ({
    name: who.get(t.userId) ?? t.userId.slice(0, 8),
    seen: daysAgo(t.lastSeenAt),
    ...parse(t.deviceInfo),
  }));

  // Devices idle for over a month are almost always retired handsets; counting
  // them as "on an old version" would overstate the problem.
  const active = rows.filter((r) => r.seen <= 30);

  console.log(
    `Registered devices: ${rows.length}   ·   active in last 30d: ${active.length}\n`,
  );

  const builds = tally(active.map((r) => r.build)).sort((a, b) =>
    a[0] === NOT_REPORTING ? 1 : b[0] === NOT_REPORTING ? -1 : buildRank(b[0]) - buildRank(a[0]),
  );
  const latest = builds.find(([b]) => b !== NOT_REPORTING)?.[0];

  console.log('=== App build (active devices) ===');
  for (const [build, n] of builds) {
    const pct = Math.round((n / active.length) * 100);
    const tag = build === latest ? '  ← latest' : '';
    console.log(`  ${build.padEnd(18)} ${String(n).padStart(3)}  (${pct}%)${tag}`);
  }

  console.log('\n=== Shorebird patch (active devices) ===');
  for (const [patch, n] of tally(active.map((r) => r.patch))) {
    const pct = Math.round((n / active.length) * 100);
    console.log(`  ${patch.padEnd(18)} ${String(n).padStart(3)}  (${pct}%)`);
  }

  console.log('\n=== Per device ===');
  for (const r of rows) {
    const patch = r.patch === NOT_REPORTING ? '—' : `patch ${r.patch}`;
    console.log(
      `  ${r.name.slice(0, 24).padEnd(26)} ${r.build.padEnd(16)} ` +
        `${patch.padEnd(12)} ${String(r.seen).padStart(3)}d ago   ${r.device}`,
    );
  }

  if (builds.some(([b]) => b === NOT_REPORTING)) {
    console.log(
      `\n  Note: "(not reporting)" = build predates version telemetry, i.e. an old version.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
