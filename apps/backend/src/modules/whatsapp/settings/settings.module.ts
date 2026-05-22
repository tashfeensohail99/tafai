import { Module } from '@nestjs/common';
import { WhatsAppSettingsController } from './settings.controller';
import { WhatsAppSettingsService } from './settings.service';

@Module({
  controllers: [WhatsAppSettingsController],
  providers: [WhatsAppSettingsService],
})
export class WhatsAppSettingsModule {}
