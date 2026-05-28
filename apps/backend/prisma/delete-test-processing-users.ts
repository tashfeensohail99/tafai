/**
 * Cleanup pair for seed-test-processing-users.ts. Finds users whose email
 * contains "+test-processing" and removes them — along with their
 * UserRole rows. Only touches accounts that match the test-flag pattern,
 * so it can't accidentally nuke real users.
 *
 * Run:
 *   cd apps/backend
 *   npx ts-node prisma/delete-test-processing-users.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_FLAG = '+test-processing';

async function main() {
  const users = await prisma.userAccount.findMany({
    where: { email: { contains: TEST_FLAG } },
    select: { id: true, email: true },
  });

  if (users.length === 0) {
    console.log('No test-processing users found. Nothing to do.');
    return;
  }

  console.log(`Found ${users.length} test user(s):`);
  users.forEach((u) => console.log(`  - ${u.email}`));

  // Safety belt: refuse to run if more than 5 matches (guards against
  // a typo or someone naming a real account "+test-processing").
  if (users.length > 5) {
    throw new Error(`Refusing to delete ${users.length} accounts — that's more than the expected 1-2. Investigate manually.`);
  }

  const userIds = users.map((u) => u.id);

  await prisma.$transaction(async (tx) => {
    // Employee.user has no onDelete cascade (defaults to Restrict), so the
    // employee row must go before the userAccount or the delete is blocked.
    // userRoles / loginSessions / notifications all cascade on userAccount
    // delete, so we don't need to touch those explicitly.
    const emps = await tx.employee.deleteMany({
      where: { userId: { in: userIds } },
    });
    console.log(`  Removed ${emps.count} employee record(s)`);

    const accounts = await tx.userAccount.deleteMany({
      where: { id: { in: userIds } },
    });
    console.log(`  Removed ${accounts.count} user account(s) (roles/sessions cascaded)`);
  });

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
