import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { LeadCapsService } from './lead-caps.service';

class SetLeadCapDto {
  /**
   * The rep's daily ONLINE-lead cap. `null` clears it (unlimited); a
   * non-negative integer sets it; `0` blocks all new online leads (a soft pause
   * that keeps existing chats). Must be sent explicitly — omitting it 400s
   * (global forbidNonWhitelisted), so "clear" is an intentional null.
   */
  @ValidateIf((o) => o.dailyLeadCap !== null)
  @IsInt()
  @Min(0)
  @Max(1000)
  dailyLeadCap!: number | null;
}

/**
 * Admin "Lead Caps" tab API. Read + write both gate on `leads.assign` (the same
 * permission that already governs admin lead reassignment — admin/super_admin
 * carry it), so no new permission or re-login is needed. The cap throttles only
 * the live online round-robin; CSV/manual/reception leads are never affected.
 */
@Controller('admin/lead-caps')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeadCapsController {
  constructor(private readonly leadCaps: LeadCapsService) {}

  /** Round-robin reps with their cap, today's online usage, and the all-capped alert. */
  @Get()
  @RequirePermissions('leads.assign')
  list() {
    return this.leadCaps.listReps();
  }

  /** Set or clear (null) one rep's daily online-lead cap. */
  @Patch(':employeeId')
  @RequirePermissions('leads.assign')
  setCap(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: SetLeadCapDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadCaps.setCap(employeeId, dto.dailyLeadCap, user.id);
  }
}
