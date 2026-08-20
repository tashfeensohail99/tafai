import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JrSettlementService } from './jr-settlement.service';
import { OpenSuccessorDto, RecordSettlementDto } from './judicial-review.dto';

/**
 * Settlement recording + the successor-matter chain (PR 6). Shares the
 * `jr/matters` base with the other JR controllers — these POSTs
 * (':matterId/settlement', ':matterId/open-successor') don't collide with their
 * routes. Each mutation carries an explicit @Audit (the global interceptor's
 * ID_PARAM_PRIORITY has no `matterId`, so entityId would otherwise be null).
 */
@Controller('jr/matters')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrSettlementController {
  constructor(private readonly settlement: JrSettlementService) {}

  @Post(':matterId/settlement')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  recordSettlement(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: RecordSettlementDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.settlement.recordSettlement(matterId, dto, user);
  }

  @Post(':matterId/open-successor')
  @RequirePermissions('jr.matter.create')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  openSuccessor(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: OpenSuccessorDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.settlement.openSuccessorMatter(matterId, dto, user);
  }
}
