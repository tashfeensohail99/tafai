import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import {
  WhatsAppThreadsController,
  WhatsAppBlockedNumbersController,
} from './threads.controller';
import { WhatsAppThreadsService } from './threads.service';

@Module({
  imports: [StorageModule],
  controllers: [WhatsAppThreadsController, WhatsAppBlockedNumbersController],
  providers: [WhatsAppThreadsService],
  exports: [WhatsAppThreadsService],
})
export class WhatsAppThreadsModule {}
