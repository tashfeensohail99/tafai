import { Module } from '@nestjs/common';
import { LeadAssignmentService } from './lead-assignment.service';

/**
 * Shared round-robin assignment, consumed by every async lead channel
 * (lead-imports, meta-leads). Depends only on the global PrismaModule, so it's
 * safe to import anywhere without coupling to the WhatsApp module.
 */
@Module({
  providers: [LeadAssignmentService],
  exports: [LeadAssignmentService],
})
export class LeadAssignmentModule {}
