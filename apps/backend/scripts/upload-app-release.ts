/**
 * Publish an Android build to the public /downloads page: uploads the
 * architecture-specific APKs plus a version manifest to STABLE storage keys
 * (served by the /public/app/* endpoints, which 302 to signed URLs).
 *
 * We ship split-per-abi builds (not one universal APK): the storage provider
 * caps single uploads (~50 MB) and a universal APK is over that. arm64-v8a is
 * the primary download; armeabi-v7a is the 32-bit fallback for older phones.
 *
 * Run: railway run --service backend -- \
 *   npx ts-node -T scripts/upload-app-release.ts <arm64-apk> [<armeabi-v7a-apk>]
 *
 * Re-running with a new build simply overwrites the keys — the
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
  const arm64Path = process.argv[2];
  const v7aPath = process.argv[3];
  if (!arm64Path) {
    throw new Error(
      'usage: upload-app-release.ts <arm64-apk> [<armeabi-v7a-apk>]',
    );
  }
  const arm64 = readFileSync(arm64Path);
  const v7a = v7aPath ? readFileSync(v7aPath) : null;

  const pubspec = readFileSync(
    join(__dirname, '..', '..', 'mobile', 'pubspec.yaml'),
    'utf-8',
  );
  const version = /^version:\s*(\S+)/m.exec(pubspec)?.[1] ?? 'unknown';

  // StorageService has no DI dependencies — it configures itself from env
  // (provided here by `railway run`), so we can use it directly.
  const storage = new StorageService();
  const APK_MIME = 'application/vnd.android.package-archive';
  await storage.uploadAt(APP_APK_KEY, arm64, APK_MIME);
  if (v7a) await storage.uploadAt(APP_APK_V7A_KEY, v7a, APK_MIME);

  const info = {
    version,
    // The primary download is arm64-v8a; the page also offers the v7a build
    // for 32-bit phones via /public/app/android/v7a.
    abi: 'arm64-v8a',
    sizeBytes: arm64.length,
    v7aSizeBytes: v7a?.length ?? null,
    uploadedAt: new Date().toISOString(),
  };
  await storage.uploadAt(
    APP_INFO_KEY,
    Buffer.from(JSON.stringify(info, null, 2)),
    'application/json',
  );
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(
    `published v${info.version}: arm64 ${mb(arm64.length)}` +
      (v7a ? ` + v7a ${mb(v7a.length)}` : ' (no v7a build)'),
  );
}

void main();
