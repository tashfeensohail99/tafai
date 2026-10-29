/**
 * Safe, idempotent production sync for the new-post staff-engagement alert.
 *
 * Additive only: upsert `social.alerts.manage` and grant it. No deletes — safe
 * to run repeatedly. (`prisma db seed` is NOT safe in prod.)
 *
 *   railway run --service backend -- npx ts-node -T scripts/sync-social-alerts-perms.ts
 *
 * Already-signed-in users pick up the new permission on their next token
 * refresh (~15 min) or re-login.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMS = [
  { key: 'social.alerts.manage', module: 'social', description: 'Configure the new-post staff-engagement alert (on/off, departments, channels, quiet hours)' },
];

const GRANTS: Record<string, string[]> = {
  super_admin: ['social.alerts.manage'],
  admin: ['social.alerts.manage'],
  marketing: ['social.alerts.manage'],
};

async function main() {
  const permId = new Map<string, string>();
  for (const p of PERMS) {
    const perm = await prisma.permission.upsert({ where: { key: p.key }, update: { module: p.module, description: p.description }, create: p });
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
      const existing = await prisma.rolePermission.findFirst({ where: { roleId: role.id, permissionId: pid }, select: { id: true } });
      if (existing) {
        console.log(`  ${roleName} ✓ ${key} (already granted)`);
        continue;
      }
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: pid } });
      console.log(`  ${roleName} + ${key} GRANTED`);
    }
  }
  console.log('\ndone — social-alerts permission synced');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
