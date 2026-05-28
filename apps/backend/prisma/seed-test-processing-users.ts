/**
 * One-shot seed: creates two TEST processing users (manager + associate).
 * Idempotent — if either user already exists, skips.
 *
 * Run:
 *   cd apps/backend
 *   npx ts-node prisma/seed-test-processing-users.ts
 *
 * Clean up when done with the matching delete script:
 *   npx ts-node prisma/delete-test-processing-users.ts
 *
 * Test credentials are intentionally NOT logged here so they don't leak
 * into terminal history. They're hard-coded below and printed once on
 * success — copy them, close the terminal, then run the delete script.
 */
import { PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Email prefix + suffix shape so we can find + clean up later with a single
// LIKE-style query: both addresses contain '+test-processing'.
const MANAGER_EMAIL = 'test-processing-manager+test-processing@tashfeen.com';
const ASSOCIATE_EMAIL = 'test-processing-associate+test-processing@tashfeen.com';
const TEST_PASSWORD = 'TestProc!2026';

async function ensureRole(name: string) {
  const role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    throw new Error(`Role "${name}" not found. Run the main db:seed first.`);
  }
  return role;
}

async function upsertUser(opts: {
  email: string;
  fullName: string;
  roleName: string;
  passwordHash: string;
}) {
  const existing = await prisma.userAccount.findUnique({ where: { email: opts.email } });
  if (existing) {
    console.log(`✓ User ${opts.email} already exists (id ${existing.id}) — leaving as-is`);
    return existing;
  }
  const role = await ensureRole(opts.roleName);
  // UserAccount has NO name column — the human name lives on the Employee
  // relation. We attach a minimal Employee so the officer roster + reports
  // show a real name instead of the email handle.
  const [firstName, ...rest] = opts.fullName.split(' ');
  const lastName = rest.join(' ') || 'User';
  const user = await prisma.userAccount.create({
    data: {
      email: opts.email,
      passwordHash: opts.passwordHash,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      userRoles: {
        create: { roleId: role.id },
      },
      employee: {
        create: {
          firstName,
          lastName,
          employeeCode: `TEST-${Date.now().toString().slice(-6)}`,
          isActive: true,
          joiningDate: new Date(),
        },
      },
    },
  });
  console.log(`✓ Created user ${opts.email} (id ${user.id}) with role ${opts.roleName}`);
  return user;
}

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  await upsertUser({
    email: MANAGER_EMAIL,
    fullName: 'Test Processing Manager',
    roleName: 'processing_manager',
    passwordHash,
  });

  await upsertUser({
    email: ASSOCIATE_EMAIL,
    fullName: 'Test Processing Associate',
    roleName: 'processing',
    passwordHash,
  });

  console.log('');
  console.log('===========================================================');
  console.log(' TEST PROCESSING USERS READY');
  console.log('===========================================================');
  console.log(' Manager   : ' + MANAGER_EMAIL);
  console.log(' Associate : ' + ASSOCIATE_EMAIL);
  console.log(' Password  : ' + TEST_PASSWORD);
  console.log('');
  console.log(' Both users are flagged with "+test-processing" in their');
  console.log(' email so the delete script can find them safely.');
  console.log('===========================================================');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
