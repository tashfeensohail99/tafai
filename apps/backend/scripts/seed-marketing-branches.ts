/**
 * Phase 1E branch reshape — makes Islamabad + Lahore the two live branches
 * marketing routes to, and migrates the existing 3 seed rules from the
 * hardcoded AD_ROUTING map into the new AdRoutingRule table.
 *
 * Idempotent — safe to re-run:
 *   1. Ensure "Islamabad" branch exists.
 *   2. Move every employee whose branch is the legacy "Main Branch" (Toronto)
 *      OR NULL onto Islamabad.
 *   3. Ensure the six LAHORE_DESK employees sit on the "Lahore" branch.
 *   4. Mark the legacy Toronto branch inactive so it drops out of dropdowns
 *      but existing FKs (leads/clients that once pointed at it) stay intact.
 *   5. Upsert the three pre-existing hardcoded ad routes as AdRoutingRule rows
 *      (targeting Lahore) so the seam behaves identically the moment
 *      assignment.service starts reading from the DB.
 *
 *   railway run --service backend -- \
 *     apps\backend\node_modules\.bin\ts-node.cmd -T \
 *     apps\backend\scripts\seed-marketing-branches.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Kept in sync with LAHORE_DESK in assignment.service.ts. Once this script has
// been run, that constant becomes documentation only — the DB is the source of
// truth (via Employee.branchId + AdRoutingRule).
const LAHORE_DESK_IDS = [
  '4d0802f0-30f5-469b-9279-e57536815c8e', // Tabida Bilal
  '88016096-7b41-4c59-b6e7-a6d8bca2908f', // Samiya Aslam
  '2faaef9e-8583-43bc-92d4-b739dd1d8ab5', // Rubab
  '1a0b7967-e27e-431a-9efd-f4dfe923c779', // Ifra Qaiser Mehmood
  '1beff9a3-8f13-4669-8faf-03325a3735e0', // Noman Gondal
  '6439a4ca-3626-4ba8-a274-610719acf2c4', // Aqsa Sadiq
];

// Same ad ids the hardcoded AD_ROUTING has today — targetType=AD, all pinned
// to Lahore. Sourced from assignment.service.ts:65-73.
const AD_RULE_SEED: Array<{ adId: string; note: string }> = [
  { adId: '52533803620533', note: 'Judicial Review — verified live' },
  { adId: '52531891901333', note: 'C11 (no chats yet)' },
  { adId: '52531891900933', note: 'Business Permit to Canada PR (C11-theme, actually delivering)' },
];

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
  if (!org) throw new Error('No Organization row — cannot seed branches');
  console.log(`Org: ${org.name}\n`);

  // 1. Islamabad (create if missing).
  let islamabad = await prisma.branch.findFirst({
    where: { organizationId: org.id, name: { equals: 'Islamabad', mode: 'insensitive' } },
  });
  if (!islamabad) {
    islamabad = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Islamabad',
        city: 'Islamabad',
        country: 'Pakistan',
        isActive: true,
      },
    });
    console.log(`Created branch Islamabad ${islamabad.id.slice(0, 8)}`);
  } else if (!islamabad.isActive) {
    islamabad = await prisma.branch.update({ where: { id: islamabad.id }, data: { isActive: true } });
    console.log(`Re-activated Islamabad`);
  } else {
    console.log(`Islamabad already present ${islamabad.id.slice(0, 8)}`);
  }

  // 2. Lahore (assumed already there per prod state — create if missing).
  let lahore = await prisma.branch.findFirst({
    where: { organizationId: org.id, name: { equals: 'Lahore', mode: 'insensitive' } },
  });
  if (!lahore) {
    lahore = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Lahore',
        city: 'Lahore',
        country: 'Pakistan',
        isActive: true,
      },
    });
    console.log(`Created branch Lahore ${lahore.id.slice(0, 8)}`);
  } else if (!lahore.isActive) {
    lahore = await prisma.branch.update({ where: { id: lahore.id }, data: { isActive: true } });
    console.log(`Re-activated Lahore`);
  } else {
    console.log(`Lahore already present ${lahore.id.slice(0, 8)}`);
  }

  // 3. Migrate legacy branches (Main Branch / Toronto / anything not Islamabad
  //    or Lahore) and NULL-branch employees onto Islamabad.
  const legacyBranches = await prisma.branch.findMany({
    where: {
      organizationId: org.id,
      id: { notIn: [islamabad.id, lahore.id] },
    },
    select: { id: true, name: true },
  });
  const legacyIds = legacyBranches.map((b) => b.id);
  console.log(`\nLegacy branches to drain: ${legacyBranches.map((b) => b.name).join(', ') || '(none)'}`);

  const movedToIsb = await prisma.employee.updateMany({
    where: {
      OR: [{ branchId: null }, ...(legacyIds.length ? [{ branchId: { in: legacyIds } }] : [])],
      id: { notIn: LAHORE_DESK_IDS },
      deletedAt: null,
    },
    data: { branchId: islamabad.id },
  });
  console.log(`Moved ${movedToIsb.count} employees onto Islamabad`);

  // 4. Ensure the 6 LAHORE_DESK employees sit on Lahore. (Only touches rows
  //    that exist — the count reflects the actual overlap with the prod roster.)
  const movedToLhr = await prisma.employee.updateMany({
    where: { id: { in: LAHORE_DESK_IDS } },
    data: { branchId: lahore.id },
  });
  console.log(`Moved ${movedToLhr.count} employees onto Lahore (LAHORE_DESK)`);

  // 5. Mark legacy branches inactive (safe — no FK cascade, just a flag).
  if (legacyIds.length) {
    const deact = await prisma.branch.updateMany({
      where: { id: { in: legacyIds }, isActive: true },
      data: { isActive: false },
    });
    console.log(`Deactivated ${deact.count} legacy branch(es)`);
  }

  // 6. Seed the 3 existing hardcoded ad rules as AdRoutingRule rows, pinned to
  //    Lahore, so DB-backed routing behaves identically the moment the assign-
  //    ment service switches over. Idempotent (unique on targetType+targetId).
  for (const seed of AD_RULE_SEED) {
    await prisma.adRoutingRule.upsert({
      where: { targetType_targetId: { targetType: 'AD', targetId: seed.adId } },
      create: { targetType: 'AD', targetId: seed.adId, branchIds: [lahore.id], notes: seed.note },
      update: { branchIds: [lahore.id], notes: seed.note },
    });
    console.log(`  rule ad=${seed.adId} → Lahore  (${seed.note})`);
  }

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
