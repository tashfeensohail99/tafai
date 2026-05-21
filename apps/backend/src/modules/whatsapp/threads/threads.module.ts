import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { WhatsAppThreadsController } from './threads.controller';
import { WhatsAppThreadsService } from './threads.service';

@Module({
  imports: [StorageModule],
  controllers: [WhatsAppThreadsController],
  providers: [WhatsAppThreadsService],
  exports: [WhatsAppThreadsService],
})
export class WhatsAppThreadsModule {}
