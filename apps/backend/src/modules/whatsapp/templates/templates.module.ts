import { Module } from '@nestjs/common';
import { WhatsAppTemplatesController } from './templates.controller';
import { WhatsAppTemplateAdminController } from './templates-admin.controller';

@Module({
  controllers: [WhatsAppTemplatesController, WhatsAppTemplateAdminController],
})
export class WhatsAppTemplatesModule {}
