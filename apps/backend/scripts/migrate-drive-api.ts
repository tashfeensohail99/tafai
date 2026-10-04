/**
 * Google Drive (LIVE API) → Databank migration.
 *
 * Sibling of migrate-drive-databank.ts. That one walks a LOCAL export; THIS one
 * pulls straight from Google Drive over the API using a Workspace SERVICE ACCOUNT
 * with DOMAIN-WIDE DELEGATION — so it can read ANY employee's Drive (read-only),
 * with no per-user sharing and no Takeout. Bytes go Drive → this process → R2,
 * never touching a local export folder.
 *
 * WHAT IT DOES (identical placement logic to the local-export migrator):
 *   - Impersonates each officer, lists their Drive, and treats each TOP-LEVEL
 *     folder as one client (matched by reference code / CNIC / passport / exact
 *     "First Last" name — never guessed; unmatched folders are reported, not
 *     dropped).
 *   - Recreates the folder tree as DatabankFolder rows (reused by name, never
 *     duplicated) and imports every file as a DatabankFile row with
 *     source=MIGRATED and migrationSourcePath set (audit trail).
 *   - Google-native files (Docs/Sheets/Slides/Drawings) are EXPORTED to
 *     .docx/.xlsx/.pptx/.png (Drive can't download them as-is); other Google
 *     app types (Forms, Scripts, …) are skipped and reported.
 *
 * WHY NO NEW DEPENDENCY: the service-account OAuth flow (a signed JWT assertion
 * exchanged for an access token, with `sub` = the impersonated user) is done with
 * Node's built-in `crypto`, and Drive is a plain REST API hit with the already-
 * present `axios`. The backend ships a standalone package-lock + `npm ci`, so
 * adding a package would mean a lockfile sync; this avoids all of that.
 *
 * SAFE BY DESIGN (mirrors the local migrator):
 *   - DRY=1 does everything EXCEPT uploading/writing — prints the match report.
 *   - Idempotent: a file already migrated (same client + same source path) is
 *     skipped, so a re-run after a crash/timeout is safe.
 *   - Read-only Drive scope; the credential is never logged.
 *
 * RUN (from apps/backend; env injected by `railway run`):
 *   # one officer, dry run first:
 *   DRY=1 GOOGLE_SA_KEY_JSON="$(cat sa-key.json)" IMPERSONATE_EMAIL=wajiha@tashfeenimmigrationsolutions.com \
 *     railway run npx tsx scripts/migrate-drive-api.ts
 *   # review drive-api-migration-report.json, then for real:
 *   GOOGLE_SA_KEY_JSON="$(cat sa-key.json)" IMPERSONATE_EMAIL=wajiha@tashfeenimmigrationsolutions.com \
 *     railway run npx tsx scripts/migrate-drive-api.ts
 *   # all processing officers (those with assigned cases), each their own Drive:
 *   ALL_OFFICERS=1 GOOGLE_SA_KEY_JSON="$(cat sa-key.json)" railway run npx tsx scripts/migrate-drive-api.ts
 *
 * ENV:
 *   GOOGLE_SA_KEY_JSON   service-account key JSON (string)   ─┐ one of these
 *   GOOGLE_SA_KEY_FILE   path to the key JSON file           ─┘ is required
 *   IMPERSONATE_EMAIL    the one Workspace user to pull       ─┐ one of these
 *   OFFICER_EMAILS       comma-separated list of users        │ selects WHO
 *   ALL_OFFICERS         truthy = every officer with cases    ─┘ (from our DB)
 *   DRY                  truthy = dry run, no writes
 *   ROOT_FOLDER_ID       Drive folder id to start from (single-user only; default 'root')
 *   INCLUDE_SHARED_DRIVES truthy = also traverse shared drives
 *   LIMIT                only first N top-level folders per officer
 *   REF_REGEX            reference-code pattern; default TIS-\d{4}-\d+
 *   MAX_MB               skip files larger than this (default 200)
 *   plus the app's own STORAGE_* / SUPABASE_* and DATABASE_URL / DIRECT_URL.
 */

import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import axios, { type AxiosInstance } from 'axios';
import { PrismaClient, DatabankFileSource } from '@prisma/client';
import { StorageService } from '../src/modules/storage/storage.service';

const prisma = new PrismaClient();
const storage = new StorageService();

const DRY = !!process.env.DRY;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const REF_REGEX = new RegExp(process.env.REF_REGEX ?? 'TIS-\\d{4}-\\d+', 'i');
const MAX_BYTES = (process.env.MAX_MB ? parseInt(process.env.MAX_MB, 10) : 200) * 1024 * 1024;
const ROOT_FOLDER_ID = process.env.ROOT_FOLDER_ID || 'root';
const INCLUDE_SHARED = !!process.env.INCLUDE_SHARED_DRIVES;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Google-native types that must be EXPORTED (can't be downloaded as-is). */
const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: 'png' },
};

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
const mimeForName = (name: string) => MIME[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';

const normNameKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const digitsOnly = (s: string) => s.replace(/\D/g, '');
const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

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
  officersProcessed: 0,
  clientsMatched: 0,
  foldersCreated: 0,
  filesMigrated: 0,
  filesSkippedExisting: 0,
  filesSkippedOversize: 0,
  filesSkippedUnsupported: 0,
  errors: [] as { path: string; error: string }[],
  unmatched: [] as { officer: string; folder: string; reason: string; detail?: string }[],
};

// ---------------------------------------------------------------- credentials
function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SA_KEY_JSON
    ? process.env.GOOGLE_SA_KEY_JSON
    : process.env.GOOGLE_SA_KEY_FILE
      ? fs.readFileSync(process.env.GOOGLE_SA_KEY_FILE, 'utf8')
      : '';
  if (!raw) {
    throw new Error('Set GOOGLE_SA_KEY_JSON (the key JSON string) or GOOGLE_SA_KEY_FILE (a path to it).');
  }
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SA_KEY_JSON / GOOGLE_SA_KEY_FILE is not valid JSON.');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service-account key is missing client_email / private_key.');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/** Mint a short-lived OAuth access token that impersonates `subject`, via the
 *  signed-JWT-bearer service-account flow (domain-wide delegation). */
async function mintAccessToken(sa: ServiceAccount, subject: string): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      sub: subject,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const assertion = `${unsigned}.${b64url(signature)}`;

  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return { token: res.data.access_token as string, expiresAt: now + 3300 }; // refresh a little early
}

/** A per-officer Drive client that transparently re-mints the token when it
 *  nears expiry (a big migration can outlast the 1-hour token). */
function driveClient(sa: ServiceAccount, subject: string) {
  let token = '';
  let expiresAt = 0;
  const ensure = async (): Promise<string> => {
    if (!token || Math.floor(Date.now() / 1000) >= expiresAt) {
      const minted = await mintAccessToken(sa, subject);
      token = minted.token;
      expiresAt = minted.expiresAt;
    }
    return token;
  };
  const http = (): AxiosInstance => axios.create({ baseURL: DRIVE_API });
  const authHeader = async () => ({ Authorization: `Bearer ${await ensure()}` });

  return {
    /** List the non-trashed children of a Drive folder (paginated). */
    async listChildren(parentId: string): Promise<DriveFile[]> {
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const res = await http().get('/files', {
          headers: await authHeader(),
          params: {
            q: `'${parentId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, size)',
            pageSize: 1000,
            orderBy: 'folder,name',
            supportsAllDrives: true,
            includeItemsFromAllDrives: INCLUDE_SHARED,
            ...(INCLUDE_SHARED ? { corpora: 'allDrives' } : {}),
            pageToken,
          },
        });
        for (const f of (res.data.files ?? []) as DriveFile[]) out.push(f);
        pageToken = res.data.nextPageToken;
      } while (pageToken);
      return out;
    },

    /** Stream a Drive file to a local temp path. Returns the written path +
     *  effective filename + mime, or null if the type is unsupported. */
    async downloadToTemp(file: DriveFile): Promise<{ tmpPath: string; fileName: string; mimeType: string } | null> {
      const tmpPath = path.join(os.tmpdir(), `dbx-${crypto.randomUUID()}`);
      const nativeExport = GOOGLE_EXPORT[file.mimeType];
      const isGoogleApp = file.mimeType.startsWith('application/vnd.google-apps.');

      if (isGoogleApp && !nativeExport) return null; // Forms, Scripts, Sites … — unsupported

      const url = nativeExport ? `/files/${file.id}/export` : `/files/${file.id}`;
      const params = nativeExport
        ? { mimeType: nativeExport.mime }
        : { alt: 'media', supportsAllDrives: true };

      const res = await http().get(url, { headers: await authHeader(), params, responseType: 'stream' });
      await pipeline(res.data as NodeJS.ReadableStream, fs.createWriteStream(tmpPath));

      let fileName = file.name;
      let mimeType: string;
      if (nativeExport) {
        if (!fileName.toLowerCase().endsWith(`.${nativeExport.ext}`)) fileName = `${fileName}.${nativeExport.ext}`;
        mimeType = nativeExport.mime;
      } else {
        mimeType = file.mimeType && file.mimeType !== 'application/octet-stream' ? file.mimeType : mimeForName(fileName);
      }
      return { tmpPath, fileName, mimeType };
    },
  };
}

// ----------------------------------------------------------------- DB helpers
async function loadClients(): Promise<(folderName: string) => Match> {
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

  return (folderName: string): Match => {
    const ref = folderName.match(REF_REGEX)?.[0]?.toUpperCase();
    if (ref && byRef.has(ref)) return { ok: true, clientId: byRef.get(ref)!, strategy: `ref:${ref}` };
    const cnic = digitsOnly(folderName);
    if (cnic.length >= 13 && byCnic.has(cnic.slice(0, 13))) {
      return { ok: true, clientId: byCnic.get(cnic.slice(0, 13))!, strategy: 'cnic' };
    }
    const pass = normNameKey(folderName);
    if (byPassport.has(pass)) return { ok: true, clientId: byPassport.get(pass)!, strategy: 'passport' };
    const ids = byName.get(normNameKey(folderName));
    if (ids && ids.length === 1) return { ok: true, clientId: ids[0], strategy: 'name' };
    if (ids && ids.length > 1) return { ok: false, reason: 'ambiguous', detail: `${ids.length} clients share this name` };
    return { ok: false, reason: 'no-match' };
  };
}

const ensureFolder = async (clientId: string, parentFolderId: string | null, name: string): Promise<string | null> => {
  const existing = await prisma.databankFolder.findFirst({
    where: { clientId, parentFolderId, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (DRY) {
    report.foldersCreated += 1;
    return null;
  }
  const created = await prisma.databankFolder.create({ data: { clientId, parentFolderId, name }, select: { id: true } });
  report.foldersCreated += 1;
  return created.id;
};

async function migrateFile(
  drive: ReturnType<typeof driveClient>,
  clientId: string,
  folderId: string | null,
  file: DriveFile,
  sourcePath: string,
) {
  const declaredSize = file.size ? parseInt(file.size, 10) : 0;
  if (declaredSize && declaredSize > MAX_BYTES) {
    report.filesSkippedOversize += 1;
    report.errors.push({ path: sourcePath, error: `oversize (${(declaredSize / 1048576).toFixed(1)} MB > ${MAX_BYTES / 1048576} MB)` });
    return;
  }

  // Idempotency: same client + same source path already migrated → skip.
  const dupe = await prisma.databankFile.findFirst({
    where: { clientId, migrationSourcePath: sourcePath, deletedAt: null },
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

  let tmpPath: string | null = null;
  try {
    const dl = await drive.downloadToTemp(file);
    if (!dl) {
      report.filesSkippedUnsupported += 1;
      report.errors.push({ path: sourcePath, error: `unsupported Google type ${file.mimeType}` });
      return;
    }
    tmpPath = dl.tmpPath;
    const size = fs.statSync(tmpPath).size;
    if (size > MAX_BYTES) {
      report.filesSkippedOversize += 1;
      report.errors.push({ path: sourcePath, error: `oversize after export (${(size / 1048576).toFixed(1)} MB)` });
      return;
    }

    const uploaded = await storage.uploadStreamFromFile(tmpPath, size, dl.mimeType, `databank/clients/${clientId}`, dl.fileName);

    // Mirror DatabankService.lockLiveDestinationFolder: FOR SHARE on the live
    // destination folder before inserting, so an admin deleteFolder racing this
    // migration can't strand a live file in a trashed folder. Land at root if it
    // was trashed meanwhile. The slow download/upload above stays OUTSIDE the tx.
    await prisma.$transaction(async (tx) => {
      let dest = folderId;
      if (folderId) {
        const live = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "processing"."databank_folders"
          WHERE "id" = ${folderId} AND "deletedAt" IS NULL AND "clientId" = ${clientId}
          FOR SHARE`;
        dest = live.length ? folderId : null;
      }
      await tx.databankFile.create({
        data: {
          clientId,
          folderId: dest,
          fileName: dl.fileName,
          storageKey: uploaded.key,
          mimeType: dl.mimeType,
          fileSizeBytes: uploaded.sizeBytes,
          source: DatabankFileSource.MIGRATED,
          migrationSourcePath: sourcePath,
        },
      });
    });
    report.filesMigrated += 1;
  } catch (e) {
    report.errors.push({ path: sourcePath, error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* temp cleanup best-effort */
      }
    }
  }
}

/** Recurse a client's Drive subtree, mirroring folders as databank folders. */
async function walk(
  drive: ReturnType<typeof driveClient>,
  clientId: string,
  driveFolderId: string,
  parentFolderId: string | null,
  pathPrefix: string,
) {
  const children = await drive.listChildren(driveFolderId);
  for (const child of children) {
    const childPath = `${pathPrefix}/${child.name}`;
    if (child.mimeType === FOLDER_MIME) {
      // eslint-disable-next-line no-await-in-loop
      const folderId = await ensureFolder(clientId, parentFolderId, child.name);
      // eslint-disable-next-line no-await-in-loop
      await walk(drive, clientId, child.id, folderId, childPath);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await migrateFile(drive, clientId, parentFolderId, child, childPath);
    }
  }
}

// --------------------------------------------------------- officer resolution
async function resolveOfficerEmails(): Promise<string[]> {
  if (process.env.OFFICER_EMAILS) {
    return process.env.OFFICER_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
  }
  if (process.env.IMPERSONATE_EMAIL) return [process.env.IMPERSONATE_EMAIL.trim()];
  if (process.env.ALL_OFFICERS) {
    const rows = await prisma.processingCase.findMany({
      where: { assignedOfficerId: { not: null } },
      select: { assignedOfficerId: true },
      distinct: ['assignedOfficerId'],
    });
    const ids = rows.map((r) => r.assignedOfficerId).filter((x): x is string => !!x);
    const accts = await prisma.userAccount.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { email: true } });
    return accts.map((a) => a.email);
  }
  throw new Error('Choose WHO to migrate: set IMPERSONATE_EMAIL, OFFICER_EMAILS (comma list), or ALL_OFFICERS=1.');
}

async function main() {
  const sa = loadServiceAccount();
  const officers = await resolveOfficerEmails();
  if (!officers.length) throw new Error('No officers resolved to migrate.');

  console.log(`\n${DRY ? '[DRY RUN] ' : ''}Google Drive API migration`);
  console.log(`  service account : ${sa.client_email}`);
  console.log(`  officers        : ${officers.length} (${officers.join(', ')})`);
  console.log(`  start folder    : ${ROOT_FOLDER_ID}${INCLUDE_SHARED ? '  (+ shared drives)' : ''}\n`);

  const resolveClient = await loadClients();

  for (const email of officers) {
    console.log(`\n── Officer ${email} ─────────────────────────────`);
    report.officersProcessed += 1;
    const drive = driveClient(sa, email);
    // Only the single-user runs honor ROOT_FOLDER_ID; a multi-officer run always
    // starts at each officer's own My Drive root.
    const root = officers.length === 1 ? ROOT_FOLDER_ID : 'root';

    let topLevel: DriveFile[];
    try {
      topLevel = (await drive.listChildren(root)).filter((f) => f.mimeType === FOLDER_MIME);
    } catch (e) {
      report.errors.push({ path: `drive:${email}`, error: `list failed: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }

    let processed = 0;
    for (const dir of topLevel) {
      if (processed >= LIMIT) break;
      const match = resolveClient(dir.name);
      if (!match.ok) {
        report.unmatched.push({ officer: email, folder: dir.name, reason: match.reason, detail: match.detail });
        continue;
      }
      report.clientsMatched += 1;
      processed += 1;
      console.log(`✓ ${dir.name}  →  client ${match.clientId} (${match.strategy})`);
      // eslint-disable-next-line no-await-in-loop
      await walk(drive, match.clientId, dir.id, null, `drive:${email}/${dir.name}`);
    }
  }

  // ---- Report ----
  console.log(`\n${'='.repeat(56)}\n${DRY ? '[DRY RUN] ' : ''}Migration summary`);
  console.log(`  officers processed       ${report.officersProcessed}`);
  console.log(`  clients matched          ${report.clientsMatched}`);
  console.log(`  folders created          ${report.foldersCreated}`);
  console.log(`  files migrated           ${report.filesMigrated}`);
  console.log(`  files skipped (existing)  ${report.filesSkippedExisting}`);
  console.log(`  files skipped (oversize)  ${report.filesSkippedOversize}`);
  console.log(`  files skipped (unsupported) ${report.filesSkippedUnsupported}`);
  console.log(`  errors                   ${report.errors.length}`);
  console.log(`  UNMATCHED folders        ${report.unmatched.length}`);
  if (report.unmatched.length) {
    console.log(`\n  Unmatched (need manual placement):`);
    for (const u of report.unmatched) console.log(`    - [${u.officer}] "${u.folder}"  [${u.reason}${u.detail ? `: ${u.detail}` : ''}]`);
  }

  const reportPath = path.join(process.cwd(), 'drive-api-migration-report.json');
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
