import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JrIntakeService } from './jr-intake.service';
import { CreateExternalMatterDto, EscalateCaseDto } from './judicial-review.dto';

/**
 * JR intake (§11.1). Shares the `jr/matters` base with JudicialReviewController:
 * these POSTs (POST '' and POST 'from-case/:caseId') don't collide with that
 * controller's GET '' / GET ':id' / POST ':matterId/*'. Both handlers require
 * `jr.matter.create` and carry an explicit @Audit (the global interceptor's
 * ID_PARAM_PRIORITY has no `matterId`/`caseId` for a create, so entityId would
 * otherwise be null).
 */
@Controller('jr/matters')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrIntakeController {
  constructor(private readonly intake: JrIntakeService) {}

  @Post()
  @RequirePermissions('jr.matter.create')
  @Audit({ entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  createExternal(@Body() dto: CreateExternalMatterDto, @CurrentUser() user: RequestUser) {
    return this.intake.createExternalMatter(dto, user);
  }

  @Post('from-case/:caseId')
  @RequirePermissions('jr.matter.create')
  @Audit({ idParam: 'caseId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  escalateFromCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: EscalateCaseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.intake.escalateFromCase(caseId, dto, user);
  }
}
