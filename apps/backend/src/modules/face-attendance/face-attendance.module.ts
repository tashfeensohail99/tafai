import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { raw } from 'express';
import { StorageModule } from '../storage/storage.module';
import { FaceAttendanceService } from './face-attendance.service';
import { FaceWorkerClient } from './face-worker.client';
import { FaceAttendanceAdminController } from './face-attendance.controller';
import { HikIngestController } from './hik-ingest.controller';

/**
 * Self-contained online NVR face-attendance (ported from intag).
 *
 * Hikvision NVR pushes a face snapshot → POST /hik/:secret → embed via the Python
 * face-worker (ArcFace 512-d) → pgvector nearest-cosine match → burst-aggregate →
 * AttendancePunch → rolled into core.attendance_records (existing payroll input).
 * Enrollment uploads photos at /attendance/face/*.
 *
 * Deliberately additive + isolated: it only READS PrismaService (global) +
 * StorageService, reuses the existing guards, and writes to the new face tables
 * (+ the existing attendance_records). It touches no other module. The /hik route
 * needs the raw request body, so this module mounts its own raw() parser for that
 * path — main.ts is left unchanged.
 */
@Module({
  imports: [StorageModule], // StorageModule is not @Global — must import to inject StorageService
  controllers: [FaceAttendanceAdminController, HikIngestController],
  providers: [FaceAttendanceService, FaceWorkerClient],
})
export class FaceAttendanceModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(raw({ type: '*/*', limit: '8mb' }))
      .forRoutes({ path: 'hik/:secret', method: RequestMethod.POST });
  }
}
