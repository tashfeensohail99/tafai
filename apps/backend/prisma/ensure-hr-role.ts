/**
 * Back-fills the HR module's permissions + `hr` role into an already-seeded
 * production DB, WITHOUT running the whole seed (which also touches leads,
 * employees, fixtures — never safe to run in prod).
 *
 * Idempotent:
 *   1. Upserts the four hr.* permission rows.
 *   2. Creates/updates the `hr` role and (re)syncs its grants.
 *   3. APPENDS hr.* to the `admin` and `super_admin` roles (never removes
 *      their existing grants) so those roles see the HR module too.
 *
 * Run:
 *   cd apps/backend
 *   npx ts-node prisma/ensure-hr-role.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HR_PERMISSIONS = [
  { key: 'hr.view', module: 'hr', description: 'View the HR module + employee directory' },
  { key: 'hr.onboard', module: 'hr', description: 'Onboard staff (create account + business email)' },
  { key: 'hr.offboard', module: 'hr', description: 'Offboard staff (disable login + optional mailbox delete)' },
  { key: 'hr.manage', module: 'hr', description: 'Manage designations + employee HR fields' },
];

const HR_ROLE = {
  name: 'hr',
  displayName: 'HR',
  description: 'Human resources — onboard/offboard staff, business email, directory',
  permissionKeys: [
    'hr.view', 'hr.onboard', 'hr.offboard', 'hr.manage',
    'employees.view_all', 'employees.create', 'employees.update',
  ],
};

async function main() {
  // 1) Upsert the hr.* permissions.
  for (const perm of HR_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { module: perm.module, description: perm.description },
      create: perm,
    });
  }
  console.log(`✓ Upserted ${HR_PERMISSIONS.length} hr.* permissions.`);

  // 2) Create/update the hr role with its canonical grants.
  const permRecords = await prisma.permission.findMany({
    where: { key: { in: HR_ROLE.permissionKeys } },
  });
  const existing = await prisma.role.findUnique({ where: { name: HR_ROLE.name } });
  if (existing) {
    await prisma.rolePermission.deleteMany({ where: { roleId: existing.id } });
    await prisma.role.update({
      where: { id: existing.id },
      data: {
        displayName: HR_ROLE.displayName,
        description: HR_ROLE.description,
        isSystem: true,
        isActive: true,
        rolePermissions: { create: permRecords.map((p) => ({ permissionId: p.id })) },
      },
    });
    console.log(`✓ Updated role "hr" — ${permRecords.length} permissions synced.`);
  } else {
    await prisma.role.create({
      data: {
        name: HR_ROLE.name,
        displayName: HR_ROLE.displayName,
        description: HR_ROLE.description,
        isSystem: true,
        isActive: true,
        rolePermissions: { create: permRecords.map((p) => ({ permissionId: p.id })) },
      },
    });
    console.log(`✓ Created role "hr" with ${permRecords.length} permissions.`);
  }

  // 3) APPEND hr.* to admin + super_admin (don't disturb their other grants).
  const hrPermRows = await prisma.permission.findMany({
    where: { key: { in: HR_PERMISSIONS.map((p) => p.key) } },
    select: { id: true, key: true },
  });
  for (const roleName of ['admin', 'super_admin']) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      console.log(`• role "${roleName}" not present — skipped.`);
      continue;
    }
    for (const perm of hrPermRows) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
    console.log(`✓ Granted hr.* to "${roleName}".`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
