/**
 * Publish an Android build to the public /downloads page: uploads the APK(s)
 * plus a version manifest to STABLE storage keys (served by the /public/app/*
 * endpoints, which 302 to signed URLs).
 *
 * TWO modes:
 *   • UNIVERSAL (preferred — "one app, one version"):
 *       upload-app-release.ts --universal <universal-apk>
 *     One fat APK (arm + arm64) that installs on ANY phone. It's written to
 *     BOTH storage keys, so a 32-bit phone (which hits /android/v7a) and a
 *     64-bit phone (/android) download the exact same build — no split to
 *     distribute, no "which file do I send?". The existing app's ABI-detecting
 *     download keeps working (both URLs now serve the universal APK), so no
 *     app-side change is needed.
 *   • SPLIT (legacy): upload-app-release.ts <arm64-apk> [<armeabi-v7a-apk>]
 *     Separate per-ABI builds (smaller each). Kept for fallback if a universal
 *     ever exceeds the storage single-upload limit.
 *
 * Run: railway run --service backend -- \
 *   npx ts-node -T scripts/upload-app-release.ts --universal <apk>
 *
 * Re-running with a new build overwrites the keys — the
 * https://tashfeengroup.com/downloads link never changes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StorageService } from '../src/modules/storage/storage.service';
import {
  APP_APK_KEY,
  APP_APK_V7A_KEY,
  APP_INFO_KEY,
} from '../src/modules/public-downloads/public-downloads.controller';

async function main() {
  const argv = process.argv.slice(2);
  const universal = argv[0] === '--universal';
  const paths = universal ? argv.slice(1) : argv;
  const primaryPath = paths[0];
  const v7aPath = paths[1];
  if (!primaryPath) {
    throw new Error(
      'usage: upload-app-release.ts --universal <apk>   (or legacy: <arm64-apk> [<armeabi-v7a-apk>])',
    );
  }
  const primary = readFileSync(primaryPath);
  // Universal: serve the SAME one-file build at the v7a key too, so every phone
  // gets it. Split: read the separate v7a build (if provided).
  const v7a = universal ? primary : v7aPath ? readFileSync(v7aPath) : null;

  const pubspec = readFileSync(
    join(__dirname, '..', '..', 'mobile', 'pubspec.yaml'),
    'utf-8',
  );
  const version = /^version:\s*(\S+)/m.exec(pubspec)?.[1] ?? 'unknown';

  // StorageService has no DI dependencies — it configures itself from env
  // (provided here by `railway run`), so we can use it directly.
  const storage = new StorageService();
  const APK_MIME = 'application/vnd.android.package-archive';
  await storage.uploadAt(APP_APK_KEY, primary, APK_MIME);
  if (v7a) await storage.uploadAt(APP_APK_V7A_KEY, v7a, APK_MIME);

  // Preserve any runtime behavior flag (e.g. leadWhatsappMode) already set on
  // the live manifest, so republishing a build doesn't silently reset a
  // server-toggled behavior. The flag is flipped by scripts/set-mobile-flag.ts
  // or the admin portal (Admin → Settings → Mobile App). We gate on exists() so
  // a genuine first publish carries nothing, but a transient read/parse failure
  // on an EXISTING manifest aborts the publish loudly (throws) rather than
  // silently dropping a live flag.
  let carried: Record<string, unknown> = {};
  if (await storage.exists(APP_INFO_KEY)) {
    const existing = await storage.download(APP_INFO_KEY);
    const prev = JSON.parse(existing.bytes.toString('utf-8')) as Record<string, unknown>;
    if (prev.leadWhatsappMode) carried = { leadWhatsappMode: prev.leadWhatsappMode };
  }

  const info = {
    version,
    abi: universal ? 'universal' : 'arm64-v8a',
    sizeBytes: primary.length,
    v7aSizeBytes: v7a ? v7a.length : null,
    uploadedAt: new Date().toISOString(),
    ...carried,
  };
  await storage.uploadAt(
    APP_INFO_KEY,
    Buffer.from(JSON.stringify(info, null, 2)),
    'application/json',
  );
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(
    universal
      ? `published UNIVERSAL v${info.version}: ${mb(primary.length)} → served to ALL devices (arm + arm64)`
      : `published v${info.version}: arm64 ${mb(primary.length)}` +
          (v7a ? ` + v7a ${mb(v7a.length)}` : ' (no v7a build)'),
  );
}

void main();
