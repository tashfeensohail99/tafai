import { Body, Controller, Delete, Get, Ip, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import type { RequestUser } from '../../common/types/auth.types';
import { brandName, brandShortName, demoLivePhoneNumberIds, isDemoMode } from '../../common/demo-mode';
import { DemoAccessService } from './demo-access.service';
import { DemoSyncService } from './demo-sync.service';

class CreateLinkDto {
  @IsString() @MinLength(2) @MaxLength(120) label!: string;
  @IsIn(['admin', 'agent']) role!: 'admin' | 'agent';
  @IsOptional() @IsInt() @Min(1) @Max(720) hours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUses?: number;
}

class RedeemDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
}

class RunSyncDto {
  @IsOptional() @IsBoolean() full?: boolean;
  @IsOptional() @IsString({ each: true }) tables?: string[];
  @IsOptional() @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

/**
 * Public, unauthenticated runtime config. Never returns anything secret; the
 * frontend reads it once at boot to switch on the demo banner / placeholders.
 */
@Controller('config')
export class PublicConfigController {
  @Get()
  get() {
    const demoMode = isDemoMode();
    return {
      demoMode,
      brandName: brandName(),
      brandShortName: brandShortName(),
      demoLiveDisplayNumber: demoMode ? process.env.DEMO_LIVE_DISPLAY_NUMBER ?? null : null,
      demoLiveLaneEnabled: demoMode && demoLivePhoneNumberIds().length > 0,
      demoSyncIntervalMinutes: demoMode ? Number(process.env.DEMO_SYNC_INTERVAL_MINUTES ?? 3) : null,
    };
  }
}

/** Prospect-facing: exchange a sign-in link for a session. */
@Controller('demo/access')
@UseGuards(ThrottlerGuard)
export class DemoPublicController {
  constructor(private readonly access: DemoAccessService) {}

  @Post('redeem')
  redeem(@Body() dto: RedeemDto, @Ip() ip: string, @Req() req: Request) {
    if (!isDemoMode()) throw new Error('not a demo environment');
    return this.access.redeem(dto.token, ip, req.headers['user-agent']);
  }
}

/** Admin-only: sync control, leak check, link management. */
@Controller('demo/admin')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('users.assign_role')
export class DemoAdminController {
  constructor(
    private readonly sync: DemoSyncService,
    private readonly access: DemoAccessService,
  ) {}

  @Get('status')
  status() {
    return this.sync.status();
  }

  @Post('sync')
  runSync(@Body() dto: RunSyncDto) {
    return this.sync.runNow(dto);
  }

  @Post('leak-check')
  leakCheck() {
    return this.sync.leakCheck();
  }

  @Get('access-links')
  listLinks() {
    return this.access.list();
  }

  @Post('access-links')
  createLink(@Body() dto: CreateLinkDto, @CurrentUser() user: RequestUser) {
    return this.access.create({ ...dto, createdByUserId: user.id });
  }

  @Delete('access-links/:id')
  revokeLink(@Param('id', ParseUUIDPipe) id: string) {
    return this.access.revoke(id);
  }
}
