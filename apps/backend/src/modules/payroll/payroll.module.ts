import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollConfigService } from './payroll-config.service';
import { AttendanceEngineService } from './attendance-engine.service';
import { PayrollRunService } from './payroll-run.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

/**
 * Payroll + Attendance Rules Engine.
 * Raw (attendance_records) -> Computed (engine + policy) -> Approved (admin
 * overlay) -> Payroll (locked snapshot). PrismaService + AuditLogService are
 * provided globally.
 */
@Module({
  imports: [AuditLogModule],
  controllers: [PayrollController],
  providers: [PayrollConfigService, AttendanceEngineService, PayrollRunService],
  exports: [PayrollConfigService, AttendanceEngineService],
})
export class PayrollModule {}
