import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { EmailModule } from '../../email/email.module';
import { WhatsAppStatusController } from './status.controller';
import { WhatsAppStatusService } from './status.service';
import { WhatsAppStatusSweeperService } from './status-sweeper.service';

@Module({
  imports: [StorageModule, EmailModule],
  controllers: [WhatsAppStatusController],
  providers: [WhatsAppStatusService, WhatsAppStatusSweeperService],
  exports: [WhatsAppStatusService],
})
export class WhatsAppStatusModule {}
