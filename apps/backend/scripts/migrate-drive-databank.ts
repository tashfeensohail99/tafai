/**
 * Google Drive → Databank migration (Phase 4 of the databank project).
 *
 * One-off script. Walks a LOCAL export of the Processing team's Google Drive —
 * one top-level folder per client — and imports every file into that client's
 * databank, recreating the folder tree. This is how existing clients get their
 * historical documents into the CRM before Drive is decommissioned.
 *
 * WHY A LOCAL EXPORT (not the Drive API): a one-time bulk pull (Google Takeout,
 * or Drive-for-desktop sync to a folder) needs no OAuth, no API quota, and lets
 * you eyeball the tree first. Point DRIVE_ROOT at that folder.
 *
 * WHY IT REUSES StorageService (not its own S3 client): files must land in the
 * exact bucket + key layout the app serves signed URLs from, and prod may be on
 * S3/R2 OR Supabase mode. Instantiating the app's own StorageService makes the
 * upload path byte-for-byte identical to a normal in-app upload — no chance of
 * writing to the wrong place.
 *
 * SAFE BY DESIGN:
 *   - DRY=1 does everything EXCEPT uploading/writing — it prints the match
 *     report so you can confirm folder→client matching before committing.
 *   - Idempotent: a file already migrated (same client + same source path) is
 *     skipped, so a re-run after a crash/timeout is safe. Folders are reused by
 *     name, never duplicated.
 *   - Never guesses: a top-level folder that matches zero clients, or more than
 *     one, is left UNMATCHED and written to a report for manual placement.
 *     Nothing is dropped silently.
 *
 * RUN (from apps/backend):
 *   DRY=1 DRIVE_ROOT=/path/to/drive-export railway run npx tsx scripts/migrate-drive-databank.ts
 *   # review the report + drive-migration-report.json, then for real:
 *   DRIVE_ROOT=/path/to/drive-export railway run npx tsx scripts/migrate-drive-databank.ts
 *
 * ENV:
 *   DRIVE_ROOT   (required) local path to the export root (one dir per client)
 *   DRY          (optional) any truthy value = dry run, no writes
 *   LIMIT        (optional) only process the first N client folders (cautious
 *                first real run)
 *   REF_REGEX    (optional) reference-code pattern; default TIS-\d{4}-\d+
 *   MAX_MB       (optional) skip files larger than this (default 100); the
 *                uploader buffers whole files in memory
 *   plus the app's own STORAGE_* / SUPABASE_* (StorageService) and
 *   DATABASE_URL / DIRECT_URL (Prisma) — all injected by `railway run`.
 */

import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient, DatabankFileSource } from '@prisma/client';
import { StorageService } from '../src/modules/storage/storage.service';

const prisma = new PrismaClient();
const storage = new StorageService();

const DRIVE_ROOT = process.env.DRIVE_ROOT ?? '';
const DRY = !!process.env.DRY;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const REF_REGEX = new RegExp(process.env.REF_REGEX ?? 'TIS-\\d{4}-\\d+', 'i');
const MAX_BYTES = (process.env.MAX_MB ? parseInt(process.env.MAX_MB, 10) : 100) * 1024 * 1024;

const IGNORE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.git']);

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf', zip: 'application/zip',
};
const mimeFor = (name: string) => MIME[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';

/** lowercase + collapse whitespace — mirrors the bulk-import name matcher. */
const normNameKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const digitsOnly = (s: string) => s.replace(/\D/g, '');

interface ClientLite {
  id: string;
  referenceCode: string;
  firstName: string;
  lastName: string;
  passportNumber: string | null;
  cnic: string | null;
}

type Match =
  | { ok: true; clientId: string; strategy: string }
  | { ok: false; reason: 'no-match' | 'ambiguous'; detail?: string };

const report = {
  clientsMatched: 0,
  foldersCreated: 0,
  filesMigrated: 0,
  filesSkippedExisting: 0,
  filesSkippedOversize: 0,
  errors: [] as { path: string; error: string }[],
  unmatched: [] as { folder: string; reason: string; detail?: string }[],
};

async function main() {
  if (!DRIVE_ROOT || !fs.existsSync(DRIVE_ROOT)) {
    throw new Error(`DRIVE_ROOT not found: "${DRIVE_ROOT}". Set it to the local Drive export root.`);
  }
  console.log(`\n${DRY ? '[DRY RUN] ' : ''}Migrating Drive export at ${DRIVE_ROOT}\n`);

  // Preload all clients into match indexes.
  const clients: ClientLite[] = await prisma.client.findMany({
    where: { deletedAt: null },
    select: { id: true, referenceCode: true, firstName: true, lastName: true, passportNumber: true, cnic: true },
  });
  const byRef = new Map<string, string>();
  const byName = new Map<string, string[]>();
  const byPassport = new Map<string, string>();
  const byCnic = new Map<string, string>();
  for (const c of clients) {
    byRef.set(c.referenceCode.toUpperCase(), c.id);
    const nk = normNameKey(`${c.firstName} ${c.lastName}`);
    byName.set(nk, [...(byName.get(nk) ?? []), c.id]);
    if (c.passportNumber) byPassport.set(normNameKey(c.passportNumber), c.id);
    if (c.cnic) byCnic.set(digitsOnly(c.cnic), c.id);
  }
  console.log(`Loaded ${clients.length} clients.\n`);

  const resolveClient = (folderName: string): Match => {
    // 1. reference code embedded in the folder name (strongest signal)
    const ref = folderName.match(REF_REGEX)?.[0]?.toUpperCase();
    if (ref && byRef.has(ref)) return { ok: true, clientId: byRef.get(ref)!, strategy: `ref:${ref}` };
    // 2. CNIC (13 digits) or passport token
    const cnic = digitsOnly(folderName);
    if (cnic.length >= 13 && byCnic.has(cnic.slice(0, 13))) {
      return { ok: true, clientId: byCnic.get(cnic.slice(0, 13))!, strategy: 'cnic' };
    }
    const pass = normNameKey(folderName);
    if (byPassport.has(pass)) return { ok: true, clientId: byPassport.get(pass)!, strategy: 'passport' };
    // 3. whole folder name as "First Last"
    const ids = byName.get(normNameKey(folderName));
    if (ids && ids.length === 1) return { ok: true, clientId: ids[0], strategy: 'name' };
    if (ids && ids.length > 1) return { ok: false, reason: 'ambiguous', detail: `${ids.length} clients share this name` };
    return { ok: false, reason: 'no-match' };
  };

  // Find (reuse) or create a databank folder by name under a parent.
  const ensureFolder = async (
    clientId: string,
    parentFolderId: string | null,
    name: string,
  ): Promise<string | null> => {
    const existing = await prisma.databankFolder.findFirst({
      where: { clientId, parentFolderId, name, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;
    if (DRY) {
      report.foldersCreated += 1;
      return null; // no id in dry-run; children just report against the client root
    }
    const created = await prisma.databankFolder.create({
      data: { clientId, parentFolderId, name },
      select: { id: true },
    });
    report.foldersCreated += 1;
    return created.id;
  };

  const migrateFile = async (clientId: string, folderId: string | null, absPath: string) => {
    const relPath = path.relative(DRIVE_ROOT, absPath).split(path.sep).join('/');
    const fileName = path.basename(absPath);
    let size = 0;
    try {
      size = fs.statSync(absPath).size;
    } catch {
      /* fall through to read error below */
    }
    if (size > MAX_BYTES) {
      report.filesSkippedOversize += 1;
      report.errors.push({ path: relPath, error: `oversize (${(size / 1048576).toFixed(1)} MB > ${MAX_BYTES / 1048576} MB)` });
      return;
    }

    // Idempotency: same client + same source path already migrated → skip.
    const dupe = await prisma.databankFile.findFirst({
      where: { clientId, migrationSourcePath: relPath, deletedAt: null },
      select: { id: true },
    });
    if (dupe) {
      report.filesSkippedExisting += 1;
      return;
    }
    if (DRY) {
      report.filesMigrated += 1;
      return;
    }
    try {
      const bytes = fs.readFileSync(absPath);
      const uploaded = await storage.upload(bytes, mimeFor(fileName), `databank/clients/${clientId}`, fileName);
      await prisma.databankFile.create({
        data: {
          clientId,
          folderId,
          fileName,
          storageKey: uploaded.key,
          mimeType: mimeFor(fileName),
          fileSizeBytes: uploaded.sizeBytes,
          source: DatabankFileSource.MIGRATED,
          migrationSourcePath: relPath,
        },
      });
      report.filesMigrated += 1;
    } catch (e) {
      report.errors.push({ path: relPath, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Recurse a client's Drive subtree, mirroring dirs as databank folders.
  const walk = async (clientId: string, dir: string, parentFolderId: string | null) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        const folderId = await ensureFolder(clientId, parentFolderId, entry.name);
        // eslint-disable-next-line no-await-in-loop
        await walk(clientId, abs, folderId);
      } else if (entry.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        await migrateFile(clientId, parentFolderId, abs);
      }
    }
  };

  const topLevel = fs.readdirSync(DRIVE_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory() && !IGNORE.has(e.name));
  let processed = 0;
  for (const dir of topLevel) {
    if (processed >= LIMIT) break;
    const match = resolveClient(dir.name);
    if (!match.ok) {
      report.unmatched.push({ folder: dir.name, reason: match.reason, detail: match.detail });
      continue;
    }
    report.clientsMatched += 1;
    processed += 1;
    console.log(`✓ ${dir.name}  →  client ${match.clientId} (${match.strategy})`);
    // eslint-disable-next-line no-await-in-loop
    await walk(match.clientId, path.join(DRIVE_ROOT, dir.name), null);
  }

  // ---- Report ----
  console.log(`\n${'='.repeat(56)}\n${DRY ? '[DRY RUN] ' : ''}Migration summary`);
  console.log(`  clients matched          ${report.clientsMatched}`);
  console.log(`  folders created          ${report.foldersCreated}`);
  console.log(`  files migrated           ${report.filesMigrated}`);
  console.log(`  files skipped (existing) ${report.filesSkippedExisting}`);
  console.log(`  files skipped (oversize) ${report.filesSkippedOversize}`);
  console.log(`  errors                   ${report.errors.length}`);
  console.log(`  UNMATCHED folders        ${report.unmatched.length}`);
  if (report.unmatched.length) {
    console.log(`\n  Unmatched (need manual placement):`);
    for (const u of report.unmatched) console.log(`    - "${u.folder}"  [${u.reason}${u.detail ? `: ${u.detail}` : ''}]`);
  }

  const reportPath = path.join(process.cwd(), 'drive-migration-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ dryRun: DRY, at: new Date().toISOString(), ...report }, null, 2));
  console.log(`\nFull report written to ${reportPath}`);
  if (DRY) console.log('\nThis was a DRY RUN — nothing was uploaded or written. Re-run without DRY=1 to commit.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
