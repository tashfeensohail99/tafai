import { Module } from '@nestjs/common';
import { WhatsAppTemplatesController } from './templates.controller';

@Module({
  controllers: [WhatsAppTemplatesController],
})
export class WhatsAppTemplatesModule {}
