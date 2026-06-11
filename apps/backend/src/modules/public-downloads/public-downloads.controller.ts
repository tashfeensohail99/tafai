import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../storage/storage.service';

/** Stable storage keys written by scripts/upload-app-release.ts. */
export const APP_APK_KEY = 'app/tafai-arm64-v8a.apk';
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

  /** Redirect to a fresh signed URL for the latest Android APK. */
  @Get('android')
  async android(@Res() res: Response): Promise<void> {
    if (!(await this.storage.exists(APP_APK_KEY))) {
      throw new NotFoundException('No app build has been published yet');
    }
    let url = await this.storage.getSignedUrl(APP_APK_KEY);
    // Supabase signed URLs accept ?download=<name> to force a sensible
    // save-as filename instead of the storage key.
    if (url.includes('/storage/v1/object/sign/')) {
      url += `${url.includes('?') ? '&' : '?'}download=tafai-crm.apk`;
    }
    res.redirect(302, url);
  }
}
