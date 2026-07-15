import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { FaceAttendanceService } from './face-attendance.service';
import { EnrollFaceImageDto } from './face-attendance.dto';

/**
 * Admin face-enrollment management (JWT + employees permissions). Enrollment now
 * uploads employee PHOTOS — the face-worker computes the 512-d ArcFace embedding
 * server-side (no browser face model). The actual attendance capture comes from
 * the on-site NVR (see HikIngestController), not from this dashboard.
 */
@Controller('attendance/face')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FaceAttendanceAdminController {
  constructor(private readonly svc: FaceAttendanceService) {}

  /** Enroll one face sample from an uploaded photo (multipart `photo`). */
  @Post('enroll')
  @RequirePermissions('employees.create')
  @UseInterceptors(
    FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }),
  )
  enroll(
    @Body() dto: EnrollFaceImageDto,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!photo?.buffer?.length) throw new BadRequestException('A photo file is required');
    return this.svc.enrollFromImage(dto.employeeId, photo.buffer, user.id);
  }

  /** Every active employee + how many samples they have. */
  @Get('enrolled')
  @RequirePermissions('employees.view_all')
  enrolled() {
    return this.svc.listEnrolled();
  }

  /** Remove all of an employee's face samples (to re-enroll). */
  @Delete('enrollments/:employeeId')
  @RequirePermissions('employees.create')
  clear(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.svc.clearEnrollments(employeeId);
  }

  /** Admin test: who does this photo match? (no punch recorded) */
  @Post('identify')
  @RequirePermissions('employees.view_all')
  @UseInterceptors(
    FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }),
  )
  identify(@UploadedFile() photo: Express.Multer.File | undefined) {
    if (!photo?.buffer?.length) throw new BadRequestException('A photo file is required');
    return this.svc.identifyFromImage(photo.buffer);
  }
}
