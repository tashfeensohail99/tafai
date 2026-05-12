import { Module } from '@nestjs/common';
import { WhatsAppThreadsController } from './threads.controller';
import { WhatsAppThreadsService } from './threads.service';

@Module({
  controllers: [WhatsAppThreadsController],
  providers: [WhatsAppThreadsService],
  exports: [WhatsAppThreadsService],
})
export class WhatsAppThreadsModule {}
