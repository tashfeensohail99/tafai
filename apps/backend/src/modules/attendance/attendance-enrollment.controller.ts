import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AttendanceApiKeyGuard } from './attendance-api-key.guard';
import { AttendanceEnrollmentService } from './attendance-enrollment.service';
import { SubmitEnrollmentDto } from './attendance-enrollment.dto';

/**
 * Machine-to-machine endpoints consumed by the camera-attendance system
 * (auth: X-API-Key, NOT a user JWT — same key as the employee feed).
 *
 *   POST /integrations/attendance/enrollment-requests       file a PENDING request
 *   GET  /integrations/attendance/enrollment-requests/:id   poll its status
 *
 * The camera CANNOT create employees here — it only files a request that an
 * admin approves. When the admin has the feature switched off, submit() returns
 * 403 { error: "enrollment_disabled" }.
 */
@Controller('integrations/attendance/enrollment-requests')
@UseGuards(AttendanceApiKeyGuard)
export class AttendanceEnrollmentController {
  constructor(private readonly enrollment: AttendanceEnrollmentService) {}

  @Post()
  submit(@Body() dto: SubmitEnrollmentDto) {
    return this.enrollment.submit(dto);
  }

  @Get(':id')
  status(@Param('id') id: string) {
    return this.enrollment.getStatus(id);
  }
}
