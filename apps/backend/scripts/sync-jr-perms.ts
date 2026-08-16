/**
 * Safe, idempotent production sync for the Judicial Review module (access step).
 *
 * `prisma db seed` is NOT safe in prod (creates demo data), so this does ONLY
 * the additive part: upsert the `jr.*` permissions, ensure the `jr_head` and
 * `jr_associate` roles exist, and grant. No deletes — safe to run repeatedly.
 * Mirrors scripts/sync-marketing-perms.ts.
 *
 *   railway run --service backend -- npx ts-node -T scripts/sync-jr-perms.ts
 *
 * NOTE: permissions/roles are baked into the JWT at login, so an already-signed-in
 * user won't land on /jr or match the role until their token next refreshes
 * (~15 min) or they log out and back in.
 *
 * AFTER running this: create each person's login in /admin/users and tick the
 * role — "JR Head" for the head, "JR Associate" for each associate. The /jr
 * route then opens the matching module automatically (Head console vs
 * Associate workspace).
 *
 * This is the ACCESS step only (roles + routing for the prototype). The full
 * module's 16 scoped permission keys ship later with the real build (PR 1).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMS = [
  { key: 'jr.view', module: 'jr', description: 'Access the Judicial Review desk' },
];

const JR_KEYS = PERMS.map((p) => p.key);

// Both JR roles and admins get jr.view. Nothing else — JR is self-contained.
const GRANTS: Record<string, string[]> = {
  jr_head: JR_KEYS,
  jr_associate: JR_KEYS,
  super_admin: JR_KEYS,
  admin: JR_KEYS,
};

const ROLES = [
  {
    name: 'jr_head',
    displayName: 'JR Head',
    description: 'Judicial Review head — sees all matters and assigns them to associates',
  },
  {
    name: 'jr_associate',
    displayName: 'JR Associate',
    description: 'Judicial Review associate — works the matters assigned to them',
  },
];

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

  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { displayName: r.displayName, description: r.description, isActive: true },
      create: {
        name: r.name,
        displayName: r.displayName,
        description: r.description,
        isSystem: false,
        isActive: true,
      },
    });
    console.log(`role ${role.name} ready (${role.id})`);
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

  console.log('\ndone — jr_head / jr_associate roles + jr.view synced');
  console.log('NEXT: in /admin/users, create each login and tick "JR Head" or "JR Associate".');
  console.log('NOTE: already-signed-in users must re-login (or wait ~15 min) to pick up the role.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
