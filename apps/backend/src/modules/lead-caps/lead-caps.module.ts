import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { LeadCapsController } from './lead-caps.controller';
import { LeadCapsService } from './lead-caps.service';

/**
 * Admin management of per-rep daily online-lead caps. Reuses
 * LeadAssignmentService.ELIGIBLE_WHERE (a static) for the rep list, so it needs
 * no runtime dependency on LeadAssignmentModule; PrismaService is global.
 */
@Module({
  imports: [AuditLogModule],
  controllers: [LeadCapsController],
  providers: [LeadCapsService],
})
export class LeadCapsModule {}
