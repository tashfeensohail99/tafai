/**
 * Enable a rep for NEW leads but THROTTLE them to a daily cap. Reverses a
 * `presenceLocked` pause AND brings the rep back ONLINE (both needed — an
 * unpaused-but-OFFLINE rep still receives nothing), then sets `dailyLeadCap`
 * so the round-robin hands them at most N fresh leads per PKT day. Existing
 * book is untouched.
 *
 *   railway run --service backend npx tsx scripts/enable-rep-with-cap.ts "<name or id>" <capN>            # DRY-RUN
 *   railway run --service backend npx tsx scripts/enable-rep-with-cap.ts "<name or id>" <capN> --commit
 *   railway run --service backend npx tsx scripts/enable-rep-with-cap.ts "<name or id>" --clear --commit  # remove cap (unlimited)
 *
 * Requires the deploy that adds the `dailyLeadCap` column + cap enforcement.
 */
import { PrismaClient, PresenceStatus } from '@prisma/client';

const rawUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';
const u = new URL(rawUrl);
u.searchParams.set('connection_limit', '2');
u.searchParams.set('pool_timeout', '30');
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

const COMMIT = process.argv.includes('--commit');
const CLEAR = process.argv.includes('--clear');
const positionals = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const who = positionals[0];
const capArg = positionals[1];

// PKT (UTC+5, no DST) midnight of today, as a UTC instant.
function startOfPktDayUtc(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${ymd}T00:00:00+05:00`);
}

async function main() {
  if (!who || (!CLEAR && !capArg)) {
    throw new Error('usage: enable-rep-with-cap.ts "<name or id>" <capN | --clear> [--commit]');
  }
  const cap = CLEAR ? null : Number(capArg);
  if (!CLEAR && (!Number.isInteger(cap) || (cap as number) < 0)) {
    throw new Error(`cap must be a non-negative integer, got "${capArg}"`);
  }

  const nameParts = who.trim().split(/\s+/);
  const rep = await prisma.employee.findFirst({
    where: {
      OR: [
        { id: who },
        ...(nameParts.length >= 2
          ? [{ AND: [{ firstName: { equals: nameParts[0], mode: 'insensitive' as const } }, { lastName: { equals: nameParts.slice(1).join(' '), mode: 'insensitive' as const } }] }]
          : [{ firstName: { equals: who, mode: 'insensitive' as const } }]),
      ],
    },
    select: { id: true, firstName: true, lastName: true, pbxExtension: true, isActive: true, presenceStatus: true, presenceLocked: true, dailyLeadCap: true, whatsappInboxMember: true },
  });
  if (!rep) throw new Error(`no employee matched "${who}"`);

  const since = startOfPktDayUtc();
  const [todayCount, bookTotal] = await Promise.all([
    prisma.lead.count({ where: { assignedEmployeeId: rep.id, createdAt: { gte: since }, deletedAt: null } }),
    prisma.lead.count({ where: { assignedEmployeeId: rep.id, deletedAt: null } }),
  ]);

  console.log(`\n● ${rep.firstName} ${rep.lastName}  (${rep.id})  ext=${rep.pbxExtension ?? '-'}`);
  console.log(`   active=${rep.isActive}  inboxMember=${rep.whatsappInboxMember}`);
  console.log(`   BEFORE: presenceStatus=${rep.presenceStatus}  presenceLocked=${rep.presenceLocked}  dailyLeadCap=${rep.dailyLeadCap ?? '(none)'}`);
  console.log(`   existing book: ${bookTotal} leads | new leads so far today (PKT): ${todayCount}`);
  console.log(`   → target: presenceStatus=ONLINE  presenceLocked=false  dailyLeadCap=${CLEAR ? '(none / unlimited)' : cap}`);

  if (!rep.isActive || !rep.whatsappInboxMember) {
    console.log(`   ⚠ note: active=${rep.isActive} inboxMember=${rep.whatsappInboxMember} — rep must be both true to receive round-robin leads.`);
  }

  if (!COMMIT) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --commit to apply.\n`);
    return;
  }

  const fresh = await prisma.employee.update({
    where: { id: rep.id },
    data: {
      presenceLocked: false,
      presenceStatus: PresenceStatus.ONLINE,
      presenceChangedAt: new Date(),
      dailyLeadCap: cap, // null when --clear
    },
    select: { presenceStatus: true, presenceLocked: true, dailyLeadCap: true },
  });
  console.log(`\n✓ WROTE. now: presenceStatus=${fresh.presenceStatus}  presenceLocked=${fresh.presenceLocked}  dailyLeadCap=${fresh.dailyLeadCap ?? '(none)'}`);
  if (!CLEAR) console.log(`  She will receive at most ${cap} new leads per PKT day (${todayCount} already counted today). Existing ${bookTotal} leads unchanged.\n`);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
