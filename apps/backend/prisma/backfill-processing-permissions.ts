/**
 * Back-fills the processing.* permission records (missing in a prod DB
 * seeded before the Processing module shipped) and re-syncs the two
 * processing roles' permission grants.
 *
 * Why: the existing `processing` role in prod has none of the processing.*
 * permissions because those Permission rows were never created. Every
 * @RequirePermissions('processing.*') gate therefore 403s for processing
 * officers. This script creates the 17 permission rows and links them to
 * both roles per the canonical seed definition.
 *
 * Surgical: touches only the `permission` table (upsert, additive) and the
 * rolePermission rows for `processing` + `processing_manager`. Does not
 * touch any other role, user, lead, or fixture.
 *
 * Run:
 *   cd apps/backend
 *   npx ts-node prisma/backfill-processing-permissions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// The 17 processing.* permissions (verbatim from seed.ts PERMISSIONS).
const PROCESSING_PERMISSIONS = [
  { key: 'processing.intake.view', module: 'processing', description: 'View the processing intake queue' },
  { key: 'processing.intake.acknowledge', module: 'processing', description: 'Acknowledge a finance handover into processing' },
  { key: 'processing.case.view_assigned', module: 'processing', description: 'View own assigned processing cases' },
  { key: 'processing.case.view_all', module: 'processing', description: 'View all processing cases (manager / admin)' },
  { key: 'processing.case.assign', module: 'processing', description: 'Assign / reassign processing cases to officers' },
  { key: 'processing.case.update_stage', module: 'processing', description: 'Advance a case through its processing stages' },
  { key: 'processing.document.request', module: 'processing', description: 'Request a document or document correction from the client' },
  { key: 'processing.document.review', module: 'processing', description: 'Review and accept / reject submitted documents' },
  { key: 'processing.document.upload', module: 'processing', description: "Upload a document on the client's behalf" },
  { key: 'processing.document.waive', module: 'processing', description: 'Waive a document checklist item' },
  { key: 'processing.note.create', module: 'processing', description: 'Add a processing note (internal or client-facing)' },
  { key: 'processing.note.view_all', module: 'processing', description: 'View all processing notes including internal' },
  { key: 'processing.task.create', module: 'processing', description: 'Create a processing task' },
  { key: 'processing.communication.send', module: 'processing', description: 'Send a case communication to the client or officer' },
  { key: 'processing.checklist.manage', module: 'processing', description: 'Manage the document checklist templates' },
  { key: 'processing.report.view', module: 'processing', description: 'View processing reports + dashboards' },
  { key: 'processing.report.export', module: 'processing', description: 'Export processing reports as CSV' },
];

// Canonical permission key lists for each role (verbatim from seed.ts
// SYSTEM_ROLES). The role re-sync wipes + recreates rolePermission rows
// from these lists, matching how the main seed maintains them.
const PROCESSING_ASSOCIATE_KEYS = [
  'clients.view_assigned', 'cases.view_assigned', 'cases.update', 'cases.change_status',
  'documents.view_assigned', 'documents.upload',
  'appointments.view_assigned',
  'communications.view',
  'processing.intake.view',
  'processing.case.view_assigned', 'processing.case.update_stage',
  'processing.document.request', 'processing.document.review', 'processing.document.upload',
  'processing.note.create',
  'processing.task.create',
  'processing.communication.send',
];

const PROCESSING_MANAGER_KEYS = [
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
];

// ADDITIVE: only creates rolePermission rows that don't already exist.
// Never deletes a grant, so a real user's role can't lose access.
async function syncRole(roleName: string, permissionKeys: string[]) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    console.warn(`⚠ Role "${roleName}" not found — skipping.`);
    return;
  }
  const perms = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
  const foundKeys = new Set(perms.map((p) => p.key));
  const missing = permissionKeys.filter((k) => !foundKeys.has(k));
  if (missing.length > 0) {
    console.warn(`  ⚠ ${roleName}: ${missing.length} key(s) still missing: ${missing.join(', ')}`);
  }

  // What's already granted?
  const existing = await prisma.rolePermission.findMany({
    where: { roleId: role.id },
    select: { permissionId: true },
  });
  const existingIds = new Set(existing.map((e) => e.permissionId));

  const toAdd = perms.filter((p) => !existingIds.has(p.id));
  if (toAdd.length === 0) {
    console.log(`✓ ${roleName}: already has all ${perms.length} permissions — nothing to add.`);
    return;
  }

  await prisma.rolePermission.createMany({
    data: toAdd.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  console.log(`✓ ${roleName}: added ${toAdd.length} missing grant(s) (kept ${existing.length} existing).`);
}

async function main() {
  // 1. Upsert the 17 processing permissions.
  let created = 0;
  for (const p of PROCESSING_PERMISSIONS) {
    const res = await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, description: p.description },
      create: { key: p.key, module: p.module, description: p.description },
    });
    if (res) created += 1;
  }
  console.log(`✓ Upserted ${created} processing.* permissions.`);

  // 2. Re-sync both processing roles.
  await syncRole('processing', PROCESSING_ASSOCIATE_KEYS);
  await syncRole('processing_manager', PROCESSING_MANAGER_KEYS);

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
