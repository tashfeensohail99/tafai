/**
 * Publish an Android build to the public /downloads page: uploads the APK
 * plus a version manifest to STABLE storage keys (served by the
 * /public/app/* endpoints, which 302 to signed URLs).
 *
 * Run: railway run --service backend -- npx ts-node -T scripts/upload-app-release.ts <path-to-apk>
 *
 * Re-running with a new build simply overwrites both keys — the
 * https://tashfeengroup.com/downloads link never changes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StorageService } from '../src/modules/storage/storage.service';
import {
  APP_APK_KEY,
  APP_INFO_KEY,
} from '../src/modules/public-downloads/public-downloads.controller';

async function main() {
  const apkPath = process.argv[2];
  if (!apkPath) throw new Error('usage: upload-app-release.ts <path-to-apk>');
  const apk = readFileSync(apkPath);

  const pubspec = readFileSync(
    join(__dirname, '..', '..', 'mobile', 'pubspec.yaml'),
    'utf-8',
  );
  const version = /^version:\s*(\S+)/m.exec(pubspec)?.[1] ?? 'unknown';

  // StorageService has no DI dependencies — it configures itself from env
  // (provided here by `railway run`), so we can use it directly.
  const storage = new StorageService();
  await storage.uploadAt(APP_APK_KEY, apk, 'application/vnd.android.package-archive');
  const info = {
    version,
    abi: 'arm64-v8a',
    sizeBytes: apk.length,
    uploadedAt: new Date().toISOString(),
  };
  await storage.uploadAt(
    APP_INFO_KEY,
    Buffer.from(JSON.stringify(info, null, 2)),
    'application/json',
  );
  console.log(
    `published v${info.version} (${(apk.length / 1024 / 1024).toFixed(1)} MB) -> ${APP_APK_KEY}`,
  );
}

void main();
