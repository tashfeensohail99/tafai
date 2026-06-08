import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AppointmentsService } from './appointments.service';
import {
  AvailabilityQueryDto,
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './appointments.dto';
import { rowsToCsv, sendCsvDownload, todayStamp } from '../../common/csv/csv.util';

@Controller('appointments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  findAll(
    @Query() query: ListAppointmentsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.findAllAccessible(query, user);
  }

  // One-off office-hours cleanup — preview (read-only) then apply the shift.
  @Get('admin/out-of-hours')
  @RequirePermissions('appointments.view_all')
  previewOutOfHours(@CurrentUser() user: RequestUser) {
    return this.appointmentsService.reshiftOutOfHours(false, user);
  }

  @Post('admin/reshift-office-hours')
  @RequirePermissions('appointments.update')
  reshiftOfficeHours(@CurrentUser() user: RequestUser) {
    return this.appointmentsService.reshiftOutOfHours(true, user);
  }

  @Get('admin/overview')
  @RequirePermissions('appointments.view_all')
  adminOverview() {
    return this.appointmentsService.getAdminOverview();
  }

  @Get('export.csv')
  @RequirePermissions('reports.export')
  async exportCsv(
    @Query() query: ListAppointmentsQueryDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const rows = (await this.appointmentsService.findAllAccessible(query, user)) as Array<{
      id: string;
      title: string;
      appointmentType: string;
      status: string;
      scheduledAt: Date;
      durationMinutes: number;
      location: string | null;
      meetingLink: string | null;
      lead?: { firstName: string; lastName: string; phone: string } | null;
      client?: { firstName: string; lastName: string; phone: string } | null;
      case?: { caseNumber: string } | null;
    }>;
    const csv = rowsToCsv(rows, [
      { header: 'Appointment ID', value: (r) => r.id },
      { header: 'Title', value: (r) => r.title },
      { header: 'Type', value: (r) => r.appointmentType },
      { header: 'Status', value: (r) => r.status },
      { header: 'Scheduled at', value: (r) => r.scheduledAt },
      { header: 'Duration (min)', value: (r) => r.durationMinutes },
      { header: 'Location', value: (r) => r.location },
      { header: 'Meeting link', value: (r) => r.meetingLink },
      {
        header: 'Contact name',
        value: (r) => {
          const c = r.client ?? r.lead;
          return c ? `${c.firstName} ${c.lastName}`.trim() : null;
        },
      },
      {
        header: 'Contact phone',
        value: (r) => r.client?.phone ?? r.lead?.phone ?? null,
      },
      { header: 'Case number', value: (r) => r.case?.caseNumber ?? null },
    ]);
    sendCsvDownload(res, `appointments-${todayStamp()}.csv`, csv);
  }

  @Get('calendar.ics')
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  async downloadCalendar(
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const ics = await this.appointmentsService.generateIcs(user);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="tafsheen-appointments.ics"',
      'Cache-Control': 'no-cache, no-store',
    });
    res.send(ics);
  }

  /**
   * Free/busy for an agent on a PKT day → office-hours window + busy intervals +
   * open 30-min slots. Mounted before @Get(':id') so "availability" isn't parsed
   * as a UUID.
   */
  @Get('availability')
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.appointmentsService.getAvailability(query.employeeId, query.date);
  }

  @Get(':id')
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.findByIdAccessible(id, user);
  }

  @Post()
  @RequirePermissions('appointments.create')
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('appointments.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.update(id, dto, user.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('appointments.cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.cancel(id, dto, user.id);
  }

  /** Move an appointment to a new time, rejecting a double-booking. */
  @Post(':id/reschedule')
  @RequirePermissions('appointments.update')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.reschedule(id, dto, user.id);
  }
}