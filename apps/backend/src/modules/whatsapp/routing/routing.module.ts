import { Global, Module } from '@nestjs/common';
import { WhatsAppAssignmentService } from './assignment.service';

@Global()
@Module({
  providers: [WhatsAppAssignmentService],
  exports: [WhatsAppAssignmentService],
})
export class WhatsAppRoutingModule {}
