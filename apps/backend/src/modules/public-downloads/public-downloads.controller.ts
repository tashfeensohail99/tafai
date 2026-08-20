import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../storage/storage.service';

/**
 * Stable storage keys written by scripts/upload-app-release.ts.
 *
 * We publish two architecture-specific builds instead of one universal APK:
 * the storage provider caps single uploads (~50 MB) and a universal APK
 * (~86 MB) is over that, plus split builds are smaller per-download with no
 * runtime cost. arm64-v8a is the primary (every modern phone); armeabi-v7a is
 * the fallback for older 32-bit devices.
 */
export const APP_APK_KEY = 'app/tafai-arm64-v8a.apk';

/** Signed-URL lifetime for the APK download. Deliberately long (1h): a ~100MB
 *  APK over slow mobile data outlives the 5-minute default, and an expiry
 *  mid-download yields a truncated, uninstallable file. */
const APK_URL_TTL_SECONDS = 3600;
export const APP_APK_V7A_KEY = 'app/tafai-armeabi-v7a.apk';
export const APP_INFO_KEY = 'app/latest.json';

/**
 * Unauthenticated endpoints backing the public /downloads page on the
 * website, so the testing team can install the Android app without a CRM
 * login. The APK sits in the private storage bucket; each download is a
 * 302 to a fresh short-lived signed URL, so nothing is permanently public.
 */
@Controller('public/app')
export class PublicDownloadsController {
  constructor(private readonly storage: StorageService) {}

  /** Version/size metadata of the latest published Android build. */
  @Get('info')
  async info(): Promise<Record<string, unknown>> {
    try {
      const { bytes } = await this.storage.download(APP_INFO_KEY);
      return JSON.parse(bytes.toString('utf-8')) as Record<string, unknown>;
    } catch {
      throw new NotFoundException('No app build has been published yet');
    }
  }

  /** Redirect to a fresh signed URL for the primary (arm64-v8a) Android APK. */
  @Get('android')
  async android(@Res() res: Response): Promise<void> {
    await this.redirectToApk(res, APP_APK_KEY);
  }

  /**
   * Redirect to the 32-bit (armeabi-v7a) build, for older phones on which the
   * arm64 build won't install. Falls back to the primary key if a v7a build
   * was never published, so the link is never dead.
   */
  @Get('android/v7a')
  async androidV7a(@Res() res: Response): Promise<void> {
    const key = (await this.storage.exists(APP_APK_V7A_KEY))
      ? APP_APK_V7A_KEY
      : APP_APK_KEY;
    await this.redirectToApk(res, key);
  }

  private async redirectToApk(res: Response, key: string): Promise<void> {
    if (!(await this.storage.exists(key))) {
      throw new NotFoundException('No app build has been published yet');
    }
    // 1 HOUR, not the 5-minute default: the APK is ~100MB and reps download it
    // over Pakistani mobile data, where it can take far longer than 5 minutes.
    // When the default TTL expired mid-download the phone's download manager
    // retried against a dead URL and saved a TRUNCATED file — which Android
    // rejects with "App not installed / package appears to be invalid".
    // This build is a PUBLIC download, so a long-lived link leaks nothing.
    let url = await this.storage.getSignedUrl(key, APK_URL_TTL_SECONDS);
    // Supabase signed URLs accept ?download=<name> to force a sensible
    // save-as filename instead of the storage key.
    if (url.includes('/storage/v1/object/sign/')) {
      url += `${url.includes('?') ? '&' : '?'}download=tafai-crm.apk`;
    }
    res.redirect(302, url);
  }
}
