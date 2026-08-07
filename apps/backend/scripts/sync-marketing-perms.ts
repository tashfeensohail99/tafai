/**
 * Safe, idempotent production sync for the Marketing module (Phase 1A).
 *
 * `prisma db seed` is NOT safe in prod (creates demo data), so this does ONLY
 * the additive part: upsert the `marketing.*` permissions, ensure the
 * `marketing` role exists, and grant. No deletes — safe to run repeatedly.
 *
 *   railway run --service backend -- npx ts-node -T scripts/sync-marketing-perms.ts
 *
 * NOTE: permissions are baked into the JWT at login, so an already-signed-in user
 * won't see the Marketing portal / can't hit the endpoints until their token next
 * refreshes (~15 min) or they log out and back in.
 *
 * Deliberately does NOT grant `settings.manage` to marketing — that key also
 * unlocks Integrations, API Keys and Finance maintenance. Marketing gets its own
 * scoped keys; the Meta read endpoints are widened to accept them separately.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMS = [
  { key: 'marketing.view', module: 'marketing', description: 'Access the Marketing portal and overview dashboard' },
  { key: 'marketing.ads.view', module: 'marketing', description: 'View Meta ad spend, campaigns, ad sets, ads and performance' },
  { key: 'marketing.routing.manage', module: 'marketing', description: 'Set per-ad / per-campaign lead routing (Islamabad / Lahore / Both)' },
  { key: 'marketing.ai.view', module: 'marketing', description: 'View AI marketing insights and recommendations' },
];

// Marketing gets all marketing.* keys; admins keep access too. Notably NO
// finance.*/processing.*/employees.*/payroll.* and NO settings.manage.
const MARKETING_KEYS = PERMS.map((p) => p.key);
const GRANTS: Record<string, string[]> = {
  marketing: MARKETING_KEYS,
  super_admin: MARKETING_KEYS,
  admin: MARKETING_KEYS,
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

  const marketing = await prisma.role.upsert({
    where: { name: 'marketing' },
    update: {
      displayName: 'Marketing',
      description: 'Meta ads, campaigns, lead routing and marketing analytics',
      isActive: true,
    },
    create: {
      name: 'marketing',
      displayName: 'Marketing',
      description: 'Meta ads, campaigns, lead routing and marketing analytics',
      isSystem: false,
      isActive: true,
    },
  });
  console.log(`role marketing ready (${marketing.id})`);

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

  console.log('\ndone — marketing permissions + role synced');
  console.log('NEXT: create marketing@tashfeengroup.com in /admin/users and tick the Marketing role.');
  console.log('NOTE: already-signed-in users must re-login (or wait ~15 min) to pick up new permissions.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
