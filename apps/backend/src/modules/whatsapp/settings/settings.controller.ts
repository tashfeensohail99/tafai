import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { WhatsAppSettingsService } from './settings.service';
import { UpdateWhatsAppSettingsDto } from './settings.dto';
import { Audit } from '../../../common/decorators/audit.decorator';

@Controller('whatsapp/settings')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppSettingsController {
  constructor(private readonly settings: WhatsAppSettingsService) {}

  @Get()
  @RequirePermissions('whatsapp.manage_settings')
  get() {
    return this.settings.get();
  }

  @Audit({ entityType: 'WhatsAppSettings', category: 'CONFIG', severity: 'HIGH', action: 'SETTING_CHANGED' })
  @Patch()
  @RequirePermissions('whatsapp.manage_settings')
  update(@Body() dto: UpdateWhatsAppSettingsDto) {
    return this.settings.update(dto);
  }
}
