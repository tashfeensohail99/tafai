/**
 * Prod rollout for the Processing Team Lead role — a supervisor who can SEE and
 * filter the whole processing board and ADD notes, but cannot reassign, change
 * stages, upload/waive documents, manage checklists, send client messages, or
 * sign off appeals. Every one of those actions is gated on its own permission,
 * so withholding them genuinely removes the capability; `processing.case.view_all`
 * alone grants read-only visibility.
 *
 * Idempotent — safe to run repeatedly. Does three things, because prod is never
 * re-seeded:
 *   1. Ensures the NEW `processing.note.moderate` permission exists. This splits
 *      "edit/delete ANY note" out of `note.view_all`, so a Team Lead can read
 *      every note yet edit/delete only the ones she wrote (see canManageNote in
 *      processing.service.ts).
 *   2. Grants `processing.note.moderate` to the roles that must keep moderating
 *      notes — super_admin, admin, processing_manager — ADDITIVELY (never wipes
 *      their existing grants). Without this, those roles would lose note
 *      edit/delete the moment the canManageNote change deploys.
 *   3. Creates / re-syncs the `processing_team_lead` role to its canonical set.
 *
 * Run (production, via Railway — DIRECT_URL gives a stable admin connection):
 *   cd apps/backend
 *   railway run --environment production --service backend \
 *     npx tsx prisma/ensure-processing-team-lead-role.ts
 *
 * Then assign the role to the chosen lead(s) in /admin/users.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NOTE_MODERATE = {
  key: 'processing.note.moderate',
  module: 'processing',
  description:
    'Edit or delete processing notes written by other users (own notes are always editable)',
};

// Roles that must retain the ability to moderate (edit/delete) ANY note.
const MODERATOR_ROLES = ['super_admin', 'admin', 'processing_manager'];

// Mirrors SYSTEM_ROLES['processing_team_lead'] in seed.ts.
const ROLE = {
  name: 'processing_team_lead',
  displayName: 'Processing Team Lead',
  description:
    'Oversee the processing board — see every case, filter, and add notes; cannot reassign, change stages, upload/waive documents, or sign off',
  permissionKeys: [
    // Read-only visibility of the client / case / document records behind each case.
    'clients.view_all', 'cases.view_all', 'documents.view_all',
    // Enter the Processing module + see and filter the whole case board.
    'processing.intake.view', 'processing.case.view_all',
    // Read every note on any case; add notes (edit/delete limited to own — see above).
    'processing.note.view_all', 'processing.note.create',
  ],
};

async function grantNoteModerate(roleName: string, permissionId: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName }, select: { id: true } });
  if (!role) {
    console.warn(`  ⚠ role "${roleName}" not found — skipped`);
    return;
  }
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId } },
    create: { roleId: role.id, permissionId },
    update: {},
  });
  console.log(`  ✓ ${roleName} ← processing.note.moderate`);
}

async function main() {
  // 1. Ensure the new permission exists.
  const perm = await prisma.permission.upsert({
    where: { key: NOTE_MODERATE.key },
    create: NOTE_MODERATE,
    update: { module: NOTE_MODERATE.module, description: NOTE_MODERATE.description },
  });
  console.log(`✓ permission "${NOTE_MODERATE.key}" present`);

  // 2. Grant it to the moderator roles (additive — preserves their other grants).
  for (const r of MODERATOR_ROLES) await grantNoteModerate(r, perm.id);

  // 3. Create / re-sync the team-lead role.
  const permissionRecords = await prisma.permission.findMany({
    where: { key: { in: ROLE.permissionKeys } },
  });
  const foundKeys = new Set(permissionRecords.map((p) => p.key));
  const missing = ROLE.permissionKeys.filter((k) => !foundKeys.has(k));
  if (missing.length > 0) {
    console.warn(`⚠ ${missing.length} permission key(s) not found in this DB and will be skipped:`);
    console.warn('  ' + missing.join(', '));
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
        rolePermissions: { create: permissionRecords.map((p) => ({ permissionId: p.id })) },
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
        rolePermissions: { create: permissionRecords.map((p) => ({ permissionId: p.id })) },
      },
    });
    console.log(`✓ Created role "${ROLE.name}" with ${permissionRecords.length} permissions.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
