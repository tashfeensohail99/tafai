/**
 * WRITE. "Pause new leads" for a sales rep — wind them down without losing
 * their book. Sets `presenceLocked = true` + `presenceStatus = OFFLINE`, which:
 *   - drops them from every NEW-lead round-robin pool (live WhatsApp/Messenger
 *     engine + async CSV/Meta engine),
 *   - pins them OFFLINE (they can't self-toggle back online),
 *   - exempts them from the presence-accountability sweeper,
 *   - KEEPS every lead already assigned to them (those still route to them, and
 *     an admin can still hand-assign a new one on purpose).
 *
 * Requires the 20260828120000_employee_presence_locked migration to be applied
 * (i.e. run this only after the deploy that adds the `presenceLocked` column).
 *
 * Run:  cd apps/backend && railway run --service backend npx tsx scripts/pause-rep-new-leads.ts
 * Flags:
 *   --name "Iffat Hanif"   who to pause (default "Iffat Hanif"); or --id <employeeId>
 *   --commit               actually write (default DRY-RUN)
 *   --unpause              reverse it (presenceLocked=false; leaves presence OFFLINE
 *                          so they re-toggle themselves online when ready)
 */
import { PrismaClient, PresenceStatus, LeadStatus } from '@prisma/client';

const rawUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';
const u = new URL(rawUrl);
u.searchParams.set('connection_limit', '3');
u.searchParams.set('pool_timeout', '30');
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

const argVal = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const NAME = argVal('--name') ?? 'Iffat Hanif';
const ID = argVal('--id');
const COMMIT = process.argv.includes('--commit');
const UNPAUSE = process.argv.includes('--unpause');

const OPEN_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.PROPOSAL_SENT,
  LeadStatus.FOLLOW_UP,
];

async function findRep() {
  if (ID) {
    return prisma.employee.findUnique({
      where: { id: ID },
      select: { id: true, firstName: true, lastName: true, branchId: true, pbxExtension: true, isActive: true, presenceStatus: true, presenceLocked: true, whatsappInboxMember: true },
    });
  }
  const [first, ...rest] = NAME.trim().split(/\s+/);
  const last = rest.join(' ');
  const hits = await prisma.employee.findMany({
    where: {
      deletedAt: null,
      firstName: { equals: first, mode: 'insensitive' },
      ...(last ? { lastName: { equals: last, mode: 'insensitive' } } : {}),
    },
    select: { id: true, firstName: true, lastName: true, branchId: true, pbxExtension: true, isActive: true, presenceStatus: true, presenceLocked: true, whatsappInboxMember: true },
  });
  if (hits.length > 1) {
    console.error(`Ambiguous — ${hits.length} employees match "${NAME}":`);
    hits.forEach((h) => console.error(`  ${h.id}  ${h.firstName} ${h.lastName}  ext=${h.pbxExtension ?? '-'}`));
    throw new Error('Refine with --id <employeeId>.');
  }
  return hits[0] ?? null;
}

async function leadCounts(empId: string) {
  const [total, open] = await Promise.all([
    prisma.lead.count({ where: { assignedEmployeeId: empId, deletedAt: null } }),
    prisma.lead.count({ where: { assignedEmployeeId: empId, deletedAt: null, status: { in: OPEN_STATUSES } } }),
  ]);
  return { total, open };
}

async function main() {
  const action = UNPAUSE ? 'UNPAUSE' : 'PAUSE';
  console.log(`=== ${action} new leads for a rep ===  MODE: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

  const rep = await findRep();
  if (!rep) throw new Error(`No employee found for "${ID ?? NAME}".`);
  const before = await leadCounts(rep.id);

  console.log(`Rep: ${rep.firstName} ${rep.lastName}  (${rep.id})`);
  console.log(`  branch=${rep.branchId ?? '-'}  ext=${rep.pbxExtension ?? '-'}  active=${rep.isActive}  inboxMember=${rep.whatsappInboxMember}`);
  console.log(`  presence: status=${rep.presenceStatus}  locked=${rep.presenceLocked}`);
  console.log(`  leads currently assigned: ${before.total} total  (${before.open} open)  <-- these are KEPT\n`);

  if (!COMMIT) {
    if (UNPAUSE) console.log(`DRY-RUN — would set presenceLocked=false (leaving presence ${rep.presenceStatus}).`);
    else console.log(`DRY-RUN — would set presenceLocked=true + presenceStatus=OFFLINE (no lead reassignment).`);
    console.log(`Re-run with --commit to write.`);
    return;
  }

  await prisma.employee.update({
    where: { id: rep.id },
    data: UNPAUSE
      ? { presenceLocked: false, presenceChangedAt: new Date() }
      : { presenceLocked: true, presenceStatus: PresenceStatus.OFFLINE, presenceChangedAt: new Date() },
  });

  const after = await leadCounts(rep.id);
  const fresh = await prisma.employee.findUnique({
    where: { id: rep.id },
    select: { presenceStatus: true, presenceLocked: true },
  });
  console.log(`WROTE. presence now: status=${fresh?.presenceStatus}  locked=${fresh?.presenceLocked}`);
  console.log(`  leads assigned after: ${after.total} total  (${after.open} open)`);
  if (after.total !== before.total) {
    console.error(`  ⚠ lead count changed (${before.total} → ${after.total}) — investigate!`);
  } else {
    console.log(`  ✓ existing leads unchanged — nothing was reassigned.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
