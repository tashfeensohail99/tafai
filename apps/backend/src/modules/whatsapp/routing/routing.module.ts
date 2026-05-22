import { Global, Module } from '@nestjs/common';
import { WhatsAppAssignmentService } from './assignment.service';
import { WhatsAppSlaSweeperService } from './sla-sweeper.service';

@Global()
@Module({
  providers: [WhatsAppAssignmentService, WhatsAppSlaSweeperService],
  exports: [WhatsAppAssignmentService],
})
export class WhatsAppRoutingModule {}
