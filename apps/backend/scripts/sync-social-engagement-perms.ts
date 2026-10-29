/**
 * Safe, idempotent production sync for team social-engagement verification.
 *
 * `prisma db seed` is NOT safe in prod (creates demo data), so this does ONLY
 * the additive part: upsert the `social.engagement.*` permissions and grant
 * them to the right roles. No deletes — safe to run repeatedly.
 *
 *   railway run --service backend -- npx ts-node -T scripts/sync-social-engagement-perms.ts
 *
 * NOTE: permissions are baked into the JWT at login, so an already-signed-in
 * user won't see the new portal / endpoints until their token next refreshes
 * (~15 min) or they log out and back in.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMS = [
  { key: 'social.engagement.view', module: 'social', description: 'View the team social-engagement scoreboard and verified comments' },
  { key: 'social.engagement.manage', module: 'social', description: 'Manage employee social handles and trigger the verification sweep' },
  { key: 'social.engagement.submit', module: 'social', description: 'Submit a Facebook comment claim for text verification' },
];

// Managers/marketing get the full set; sales reps can submit their own claims
// (and will once the rep-facing UI ships); sales_manager also sees the board.
const GRANTS: Record<string, string[]> = {
  super_admin: ['social.engagement.view', 'social.engagement.manage', 'social.engagement.submit'],
  admin: ['social.engagement.view', 'social.engagement.manage', 'social.engagement.submit'],
  marketing: ['social.engagement.view', 'social.engagement.manage', 'social.engagement.submit'],
  sales_manager: ['social.engagement.view', 'social.engagement.submit'],
  sales: ['social.engagement.submit'],
};

async function main() {
  const permId = new Map<string, string>();
  for (const p of PERMS) {
    const perm = await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, description: p.description },
      create: p,
    });
    permId.set(p.key, perm.id);
    console.log(`permission ${perm.key} ready`);
  }

  for (const [roleName, keys] of Object.entries(GRANTS)) {
    const role = await prisma.role.findUnique({ where: { name: roleName }, select: { id: true } });
    if (!role) {
      console.log(`role ${roleName}: NOT FOUND — skipped`);
      continue;
    }
    for (const key of keys) {
      const pid = permId.get(key)!;
      const existing = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: pid },
        select: { id: true },
      });
      if (existing) {
        console.log(`  ${roleName} ✓ ${key} (already granted)`);
        continue;
      }
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: pid } });
      console.log(`  ${roleName} + ${key} GRANTED`);
    }
  }

  console.log('\ndone — social-engagement permissions synced');
  console.log('NEXT: set employee Instagram handles in the Marketing portal → Social Handles.');
  console.log('NOTE: already-signed-in users must re-login (or wait ~15 min) to pick up new permissions.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
