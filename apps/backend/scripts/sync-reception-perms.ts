/**
 * Safe, idempotent production sync for the Reception / Front-Desk module.
 *
 * `prisma db seed` is NOT safe in prod (it creates demo data), so this script
 * does ONLY the additive part the new module needs: upsert the two permissions,
 * ensure the `reception` role exists, and grant the perms to reception + the
 * admin roles. No deletes, no demo data — safe to run repeatedly.
 *
 *   railway run --service backend -- npx ts-node -T scripts/sync-reception-perms.ts
 *
 * NOTE: permissions are baked into the JWT at login, so anyone already signed in
 * won't see the Reception nav / can't hit the endpoints until their access token
 * next refreshes (~15 min) or they log out and back in. Tell affected admins to
 * re-login for immediate access.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMS = [
  {
    key: 'reception.view',
    module: 'reception',
    description: 'View the front-desk visit register and look up existing leads / clients',
  },
  {
    key: 'reception.check_in',
    module: 'reception',
    description:
      'Check visitors in / out and log walk-ins, existing clients and paid consultations',
  },
];

// The new Reception role gets both; admins get them too. Roles that may not
// exist in this environment are skipped (no error).
const GRANTS: Record<string, string[]> = {
  reception: ['reception.view', 'reception.check_in'],
  super_admin: ['reception.view', 'reception.check_in'],
  admin: ['reception.view', 'reception.check_in'],
};

async function main() {
  // 1. Upsert permissions.
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

  // 2. Ensure the Reception role exists.
  const reception = await prisma.role.upsert({
    where: { name: 'reception' },
    update: {
      displayName: 'Reception / Front Desk',
      description: 'Front-desk staff: log office visitors and paid consultations',
      isActive: true,
    },
    create: {
      name: 'reception',
      displayName: 'Reception / Front Desk',
      description: 'Front-desk staff: log office visitors and paid consultations',
      isSystem: false,
      isActive: true,
    },
  });
  console.log(`role reception ready (${reception.id})`);

  // 3. Grant.
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

  console.log('done — reception permissions + role synced');
  console.log(
    'NOTE: already-signed-in users must re-login (or wait ~15 min for token refresh) to pick up the new permissions.',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
