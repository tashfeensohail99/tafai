import { Body, Controller, Delete, Get, Param, Post, Patch, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { LeaveStatus, OfficialDutyStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditDocumentAccess } from '../../common/decorators/audit-document-access.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { PayrollConfigService } from './payroll-config.service';
import { AttendanceEngineService } from './attendance-engine.service';
import { PayrollRunService } from './payroll-run.service';
import { PayslipPdfService } from './payslip-pdf.service';
import {
  AdjustDayDto, ApproveDayDto, CreateLeaveDto, CreateOfficialDutyDto, GeneratePayrollDto,
  RecomputeDto, ReviewDutyDto, ReviewExceptionDto, ReviewLeaveDto, SetCompensationDto,
  UpdatePolicyDto, UpsertHolidayDto,
} from './payroll.dto';

/**
 * Payroll + Attendance Rules Engine — admin only. Gated on `employees.view_all`
 * (the same permission the rest of the People/HR admin uses), so it's available
 * to admins without seeding a new permission.
 */
@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('employees.view_all')
export class PayrollController {
  constructor(
    private readonly config: PayrollConfigService,
    private readonly engine: AttendanceEngineService,
    private readonly run: PayrollRunService,
    private readonly payslipPdf: PayslipPdfService,
  ) {}

  // ── Policy ──
  @Get('policy') getPolicy() { return this.config.getPolicy(); }
  @Patch('policy') updatePolicy(@Body() dto: UpdatePolicyDto, @CurrentUser() u: RequestUser) { return this.config.updatePolicy(dto, u.id); }

  // ── Holidays ──
  @Get('holidays') listHolidays(@Query('year') year?: string) { return this.config.listHolidays(year ? Number(year) : undefined); }
  @Post('holidays') upsertHoliday(@Body() dto: UpsertHolidayDto, @CurrentUser() u: RequestUser) { return this.config.upsertHoliday(dto, u.id); }
  @Delete('holidays/:id') deleteHoliday(@Param('id') id: string) { return this.config.deleteHoliday(id); }

  // ── Compensation ──
  @Get('compensation/:employeeId') listComp(@Param('employeeId') id: string) { return this.config.listCompensation(id); }
  @Post('compensation') setComp(@Body() dto: SetCompensationDto, @CurrentUser() u: RequestUser) { return this.config.setCompensation(dto, u.id); }

  // ── Attendance engine ──
  @Post('attendance/recompute') recompute(@Body() dto: RecomputeDto, @CurrentUser() u: RequestUser) { return this.engine.recompute(dto, u.id); }
  @Get('attendance/daily') daily(@Query('date') date: string) {
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
    return this.engine.listDaily(d);
  }
  @Post('attendance/approve') approve(@Body() dto: ApproveDayDto, @CurrentUser() u: RequestUser) { return this.engine.approveDay(dto.employeeId, dto.date, u.id); }
  @Post('attendance/bulk-approve') bulkApprove(@Query('date') date: string, @CurrentUser() u: RequestUser) { return this.engine.bulkApproveClean(date, u.id); }
  @Post('attendance/adjust') adjust(@Body() dto: AdjustDayDto, @CurrentUser() u: RequestUser) { return this.engine.adjustDay(dto, u.id); }
  @Get('attendance/adjustments') adjustments(@Query('employeeId') employeeId: string, @Query('date') date: string) { return this.engine.listAdjustments(employeeId, date); }

  // ── Exceptions ──
  @Post('exceptions/:id/review') reviewException(@Param('id') id: string, @Body() dto: ReviewExceptionDto, @CurrentUser() u: RequestUser) { return this.engine.reviewException(id, dto, u.id); }

  // ── Official duty ──
  @Post('duty') createDuty(@Body() dto: CreateOfficialDutyDto, @CurrentUser() u: RequestUser) { return this.engine.createDuty(dto, u.id); }
  @Get('duty') listDuty(@Query('status') status?: OfficialDutyStatus, @Query('employeeId') employeeId?: string) { return this.engine.listDuty(status, employeeId); }
  @Post('duty/:id/review') reviewDuty(@Param('id') id: string, @Body() dto: ReviewDutyDto, @CurrentUser() u: RequestUser) { return this.engine.reviewDuty(id, dto, u.id); }

  // ── Leave ──
  @Post('leave') createLeave(@Body() dto: CreateLeaveDto, @CurrentUser() u: RequestUser) { return this.engine.createLeave(dto, u.id); }
  @Get('leave') listLeave(@Query('status') status?: LeaveStatus, @Query('employeeId') employeeId?: string) { return this.engine.listLeave(status, employeeId); }
  @Post('leave/:id/review') reviewLeave(@Param('id') id: string, @Body() dto: ReviewLeaveDto, @CurrentUser() u: RequestUser) { return this.engine.reviewLeave(id, dto, u.id); }
  @Get('leave/balances/:employeeId') leaveBalances(@Param('employeeId') id: string, @Query('year') year?: string) { return this.engine.leaveBalances(id, year ? Number(year) : new Date().getUTCFullYear()); }

  // ── Payroll ──
  @Get('periods') periods() { return this.run.listPeriods(); }
  @Post('generate') generate(@Body() dto: GeneratePayrollDto, @CurrentUser() u: RequestUser) { return this.run.generate(dto.year, dto.month, u.id); }
  @Get('periods/:id/payslips') payslips(@Param('id') id: string) { return this.run.listPayslips(id); }
  @Get('payslips/:id/pdf')
  @AuditDocumentAccess('Payslip', 'id')
  async payslipPdfDownload(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, fileName } = await this.payslipPdf.render(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }
  @Post('periods/:id/lock') lock(@Param('id') id: string, @CurrentUser() u: RequestUser) { return this.run.lock(id, u.id); }
  @Post('periods/:id/unlock') unlock(@Param('id') id: string, @CurrentUser() u: RequestUser) { return this.run.unlock(id, u.id); }
}
