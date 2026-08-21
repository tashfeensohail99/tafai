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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JrCounselService } from './jr-counsel.service';
import {
  CreateCounselDto,
  ListCounselQueryDto,
  UpdateCounselDto,
} from './judicial-review.dto';

/**
 * JR counsel directory CRUD. Every route requires `jr.counsel.manage` (the same
 * permission that gates set-counsel-of-record and record-merits). Mutations carry
 * an explicit @Audit — the global interceptor's ID_PARAM_PRIORITY has no counsel
 * id for a create, so entityId would otherwise be null. captureBody is left at its
 * default (true for mutations): counsel directory data is not client work-product.
 */
@Controller('jr/counsel')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrCounselController {
  constructor(private readonly counsel: JrCounselService) {}

  @Get()
  @RequirePermissions('jr.counsel.manage')
  list(@Query() query: ListCounselQueryDto) {
    return this.counsel.list(query.activeOnly === 'true');
  }

  @Post()
  @RequirePermissions('jr.counsel.manage')
  @Audit({ entityType: 'JrCounsel', action: 'RECORD_CREATED', category: 'MUTATION', severity: 'MEDIUM' })
  create(@Body() dto: CreateCounselDto, @CurrentUser() user: RequestUser) {
    return this.counsel.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('jr.counsel.manage')
  @Audit({ idParam: 'id', entityType: 'JrCounsel', category: 'MUTATION', severity: 'MEDIUM' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCounselDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.counsel.update(id, dto, user);
  }
}
