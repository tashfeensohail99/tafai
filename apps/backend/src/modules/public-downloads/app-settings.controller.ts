import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { StorageService } from '../storage/storage.service';
import { APP_INFO_KEY } from './public-downloads.controller';
import { SetLeadWhatsappModeDto } from './app-settings.dto';

type LeadWhatsappMode = 'personal' | 'crm';

/**
 * Admin control for runtime flags carried on the published mobile manifest
 * (`app/latest.json` → served verbatim by GET /public/app/info). The mobile app
 * reads these at runtime, so flipping a value here changes app behavior with NO
 * rebuild / forced update — it takes effect on the next lead-detail open. All
 * routes require `settings.manage`. Read-modify-write preserves version/size/etc.
 */
@Controller('admin/app-settings')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('settings.manage')
export class AppSettingsController {
  constructor(private readonly storage: StorageService) {}

  /** Current lead-detail WhatsApp button mode (defaults to 'crm' when unset). */
  @Get('lead-whatsapp-mode')
  async getLeadWhatsappMode(): Promise<{ leadWhatsappMode: LeadWhatsappMode }> {
    const manifest = await this.readManifest();
    const mode = String(manifest?.leadWhatsappMode ?? '').toLowerCase();
    return { leadWhatsappMode: mode === 'personal' ? 'personal' : 'crm' };
  }

  /**
   * Flip the lead-detail WhatsApp button between the in-app CRM inbox ('crm',
   * the default) and the rep's own WhatsApp ('personal', a campaign mode).
   */
  @Audit({
    entityType: 'AppSettings',
    category: 'CONFIG',
    severity: 'HIGH',
    action: 'SETTING_CHANGED',
  })
  @Patch('lead-whatsapp-mode')
  async setLeadWhatsappMode(
    @Body() dto: SetLeadWhatsappModeDto,
  ): Promise<{ leadWhatsappMode: LeadWhatsappMode }> {
    const manifest = await this.readManifest();
    if (!manifest) {
      throw new NotFoundException(
        'No app build has been published yet — publish a build before setting mobile flags.',
      );
    }
    manifest.leadWhatsappMode = dto.leadWhatsappMode;
    await this.storage.uploadAt(
      APP_INFO_KEY,
      Buffer.from(JSON.stringify(manifest, null, 2)),
      'application/json',
    );
    return { leadWhatsappMode: dto.leadWhatsappMode };
  }

  /**
   * Returns the parsed manifest, or null ONLY when no build has been published
   * yet (the object is absent). A transient download/parse failure on an
   * EXISTING manifest propagates (→ 500) rather than being masked as "unset",
   * so the admin never sees a misleading default when the read actually failed.
   */
  private async readManifest(): Promise<Record<string, unknown> | null> {
    if (!(await this.storage.exists(APP_INFO_KEY))) return null;
    const { bytes } = await this.storage.download(APP_INFO_KEY);
    return JSON.parse(bytes.toString('utf-8')) as Record<string, unknown>;
  }
}
