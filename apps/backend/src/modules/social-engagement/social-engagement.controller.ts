import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { Audit } from '../../common/decorators/audit.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { SocialEngagementService } from './social-engagement.service';
import {
  EngagementListQuery,
  PostListQuery,
  ScoreboardQuery,
  SubmitClaimDto,
  UpdateHandleDto,
} from './social-engagement.dto';

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

function parseDays(raw: string | undefined, fallback: number): number {
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Team social-engagement verification (see
 * docs/social-engagement-verification.md). Reads are `social.engagement.view`;
 * the handle registry + manual sweep are `social.engagement.manage`; submitting
 * a Facebook claim is `social.engagement.submit`.
 */
@Controller('admin/social-engagement')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SocialEngagementController {
  constructor(private readonly svc: SocialEngagementService) {}

  @Get('scoreboard')
  @RequirePermissions('social.engagement.view')
  scoreboard(@Query() q: ScoreboardQuery) {
    return this.svc.getScoreboard(parseDays(q.days, 7));
  }

  @Get('engagements')
  @RequirePermissions('social.engagement.view')
  engagements(@Query() q: EngagementListQuery) {
    return this.svc.listEngagements({
      days: q.days !== undefined ? parseDays(q.days, 30) : undefined,
      employeeId: q.employeeId,
      platform: q.platform,
      status: q.status,
    });
  }

  @Get('posts')
  @RequirePermissions('social.engagement.view')
  posts(@Query() q: PostListQuery) {
    return this.svc.listPosts({
      days: q.days !== undefined ? parseDays(q.days, 30) : undefined,
      platform: q.platform,
    });
  }

  @Get('status')
  @RequirePermissions('social.engagement.view')
  status() {
    return this.svc.getStatus();
  }

  @Get('handles')
  @RequirePermissions('social.engagement.manage')
  handles() {
    return this.svc.listHandles();
  }

  @Patch('handles/:employeeId')
  @RequirePermissions('social.engagement.manage')
  @Audit({ idParam: 'employeeId', entityType: 'Employee', category: 'MUTATION', severity: 'LOW' })
  updateHandle(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpdateHandleDto,
  ) {
    return this.svc.updateHandle(employeeId, dto);
  }

  @Post('claims')
  @RequirePermissions('social.engagement.submit')
  @Audit({ entityType: 'SocialEngagement', action: 'RECORD_CREATED', category: 'MUTATION', severity: 'LOW' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SCREENSHOT_BYTES } }))
  submitClaim(
    @Body() dto: SubmitClaimDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.svc.submitClaim(dto, file, user.id);
  }

  @Post('sweep')
  @RequirePermissions('social.engagement.manage')
  @Audit({ entityType: 'SocialEngagement', category: 'MUTATION', severity: 'LOW' })
  runSweep() {
    return this.svc.runSweep();
  }
}
