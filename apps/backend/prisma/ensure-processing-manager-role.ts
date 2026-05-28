/**
 * Ensures the `processing_manager` role exists in the DB with the full
 * permission set the P5 Manager → Associate hierarchy depends on.
 *
 * This role is defined in the main seed (SYSTEM_ROLES) but a prod DB seeded
 * before P5 won't have it. This script back-fills it without running the
 * whole seed (which also touches leads, employees, walkthrough fixtures).
 *
 * Idempotent: if the role exists, its permission grants are re-synced to the
 * canonical list. Permission keys that don't exist in this DB are simply
 * skipped (matches how the main seed links by matching existing records).
 *
 * Run:
 *   cd apps/backend
 *   npx ts-node prisma/ensure-processing-manager-role.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Mirrors SYSTEM_ROLES['processing_manager'] in seed.ts.
const ROLE = {
  name: 'processing_manager',
  displayName: 'Processing Manager',
  description: 'Oversee processing officers — assign cases, see team workload, manage checklists',
  permissionKeys: [
    'clients.view_all', 'cases.view_all', 'cases.update', 'cases.change_status', 'cases.handover',
    'documents.view_all', 'documents.upload', 'documents.verify',
    'appointments.view_all', 'appointments.create',
    'communications.view', 'communications.send',
    'processing.intake.view', 'processing.intake.acknowledge',
    'processing.case.view_all', 'processing.case.assign', 'processing.case.update_stage',
    'processing.document.request', 'processing.document.review', 'processing.document.upload', 'processing.document.waive',
    'processing.note.create', 'processing.note.view_all',
    'processing.task.create',
    'processing.communication.send',
    'processing.checklist.manage',
    'processing.report.view', 'processing.report.export',
    'reports.view', 'reports.export',
    'employees.view_all',
  ],
};

async function main() {
  const permissionRecords = await prisma.permission.findMany({
    where: { key: { in: ROLE.permissionKeys } },
  });
  const foundKeys = new Set(permissionRecords.map((p) => p.key));
  const missing = ROLE.permissionKeys.filter((k) => !foundKeys.has(k));
  if (missing.length > 0) {
    console.warn(`⚠ ${missing.length} permission key(s) not found in this DB and will be skipped:`);
    console.warn('  ' + missing.join(', '));
    console.warn('  (Run the full db:seed if the role ends up under-permissioned.)');
  }

  const existing = await prisma.role.findUnique({ where: { name: ROLE.name } });

  if (existing) {
    await prisma.rolePermission.deleteMany({ where: { roleId: existing.id } });
    await prisma.role.update({
      where: { id: existing.id },
      data: {
        displayName: ROLE.displayName,
        description: ROLE.description,
        isSystem: true,
        rolePermissions: {
          create: permissionRecords.map((p) => ({ permissionId: p.id })),
        },
      },
    });
    console.log(`✓ Updated existing role "${ROLE.name}" — ${permissionRecords.length} permissions synced.`);
  } else {
    await prisma.role.create({
      data: {
        name: ROLE.name,
        displayName: ROLE.displayName,
        description: ROLE.description,
        isSystem: true,
        rolePermissions: {
          create: permissionRecords.map((p) => ({ permissionId: p.id })),
        },
      },
    });
    console.log(`✓ Created role "${ROLE.name}" with ${permissionRecords.length} permissions.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
