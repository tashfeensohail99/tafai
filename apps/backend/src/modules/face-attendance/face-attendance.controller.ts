import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';

/**
 * Upload ceiling for an enrolment / identify photo.
 *
 * MUST NOT exceed the face-worker's own cap (FACE_MAX_IMAGE_BYTES, default
 * 12 MB — see apps/face-worker/app/main.py). This was 15 MB, so a 13 MB photo
 * uploaded fine and then failed at the worker with an opaque 413, which reads to
 * the user as "enrolment is broken" rather than "that photo is too big".
 */
const FACE_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
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
    FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: FACE_PHOTO_MAX_BYTES, files: 1 } }),
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

  /** Auto-detected NVR channels (cameras) pushing + their role — for camera setup. */
  @Get('channels')
  @RequirePermissions('employees.view_all')
  channels() {
    return this.svc.listChannels();
  }

  /** Recent NVR captures, newest first — the camera review list. */
  @Get('events')
  @RequirePermissions('employees.view_all')
  events(@Query('limit') limit?: string, @Query('matchedOnly') matchedOnly?: string) {
    return this.svc.listRecentCaptures(
      limit === undefined ? undefined : Number(limit),
      matchedOnly === 'true' || matchedOnly === '1',
    );
  }

  /** The stored JPEG for one capture (the bucket is private — we proxy the bytes). */
  @Get('events/:id/image')
  @RequirePermissions('employees.view_all')
  async eventImage(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const { bytes, mimeType } = await this.svc.getCaptureImage(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(bytes);
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
    FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: FACE_PHOTO_MAX_BYTES, files: 1 } }),
  )
  identify(@UploadedFile() photo: Express.Multer.File | undefined) {
    if (!photo?.buffer?.length) throw new BadRequestException('A photo file is required');
    return this.svc.identifyFromImage(photo.buffer);
  }
}
