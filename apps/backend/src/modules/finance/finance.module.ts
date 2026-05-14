import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CasesModule } from '../cases/cases.module';
import { LeadsModule } from '../leads/leads.module';
import { StorageModule } from '../storage/storage.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  imports: [AuditLogModule, ActivityTimelineModule, LeadsModule, CasesModule, StorageModule],
  controllers: [FinanceController],
  providers: [FinanceService, ReceiptPdfService],
  exports: [FinanceService],
})
export class FinanceModule {}