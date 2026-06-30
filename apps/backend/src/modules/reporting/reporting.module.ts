import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { WhatsAppReportService } from './whatsapp-report.service';
import { WhatsAppDailyReportService } from './whatsapp-daily-report.service';

/**
 * Cross-department reporting. WhatsAppReportService aggregates per-rep chat
 * activity (reused by the panel endpoint + the daily email); the daily-report
 * service emails it at 8 AM PKT. PrismaService and EmailService are both
 * @Global, so no imports are needed.
 */
@Module({
  controllers: [ReportingController],
  providers: [WhatsAppReportService, WhatsAppDailyReportService],
  exports: [WhatsAppReportService],
})
export class ReportingModule {}
