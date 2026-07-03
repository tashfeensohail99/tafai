import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { Audit } from '../../common/decorators/audit.decorator';
import { ReceptionService } from './reception.service';
import {
  CreateVisitDto,
  ListVisitsQueryDto,
  LookupQueryDto,
  UpdateVisitDto,
} from './reception.dto';

@Controller('reception')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReceptionController {
  constructor(private readonly reception: ReceptionService) {}

  @Get('lookup')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  lookup(@Query() query: LookupQueryDto) {
    return this.reception.lookup(query);
  }

  @Get('hosts')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  hosts() {
    return this.reception.getHosts();
  }

  @Get('visits')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  list(@Query() query: ListVisitsQueryDto) {
    return this.reception.listVisits(query);
  }

  @Post('visits')
  @RequirePermissions('reception.check_in')
  @Audit({ entityType: 'Visit', category: 'MUTATION', severity: 'LOW' })
  create(@Body() dto: CreateVisitDto, @CurrentUser() user: RequestUser) {
    return this.reception.createVisit(dto, user.id);
  }

  @Patch('visits/:id')
  @RequirePermissions('reception.check_in')
  @Audit({ entityType: 'Visit', category: 'MUTATION', severity: 'LOW' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVisitDto) {
    return this.reception.updateVisit(id, dto);
  }
}
