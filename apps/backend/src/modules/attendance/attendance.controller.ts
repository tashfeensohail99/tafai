import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AttendanceClient } from './attendance.client';

/**
 * Admin-facing attendance endpoints. Phase 0 ships only a connectivity probe so
 * we can confirm the CRM ↔ camera link end-to-end before building the sync +
 * payroll on top. Gated to `attendance.view` (admin-only per the seed grant).
 */
@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AttendanceController {
  constructor(private readonly client: AttendanceClient) {}

  /** Confirms the camera API is reachable + credentials work. */
  @Get('ping')
  @RequirePermissions('attendance.view')
  async ping(): Promise<{ configured: boolean; ok: boolean; employeeCount?: number; error?: string }> {
    const result = await this.client.ping();
    return { configured: this.client.configured, ...result };
  }
}
