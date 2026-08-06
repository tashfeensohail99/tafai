import { Module } from '@nestjs/common';
import { SmartOfficeController } from './smart-office.controller';
import { SmartOfficeService } from './smart-office.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { LeadAssignmentModule } from '../lead-assignment/lead-assignment.module';

/**
 * Telephony integrations. Currently the Telenor Smart Office inbound-call
 * routing "Customer API" (caller -> owning salesperson -> PBX extension).
 * PrismaService is provided globally; AuditLogModule is imported so an
 * unknown-caller capture can log a LEAD_CREATED audit entry; LeadAssignmentModule
 * so a genuinely-new caller can be round-robin-assigned to a rep on the same
 * shared cursor every other channel (WhatsApp/CSV/Meta/website) uses.
 */
@Module({
  imports: [AuditLogModule, LeadAssignmentModule],
  controllers: [SmartOfficeController],
  providers: [SmartOfficeService],
})
export class TelephonyModule {}
