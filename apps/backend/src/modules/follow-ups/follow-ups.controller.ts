import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequestUser } from '../../common/types/auth.types';
import {
  CompleteFollowUpDto,
  CreateFollowUpDto,
  ListFollowUpsQueryDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';
import { FollowUpsService } from './follow-ups.service';

@Controller('follow-ups')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  /**
   * List follow-ups. Supports `?bucket=overdue|today|upcoming` (PKT) and
   * `?page=&limit=` pagination. The JSON body is the items array (unchanged for
   * existing clients); the total match count is returned in `X-Total-Count` for
   * paginating clients.
   */
  @Get()
  @RequireAnyPermissions('follow_ups.view_all', 'follow_ups.view_assigned')
  async findAll(
    @Query() query: ListFollowUpsQueryDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.followUpsService.findAllAccessible(query, user);
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    return items;
  }

  @Get(':id')
  @RequireAnyPermissions('follow_ups.view_all', 'follow_ups.view_assigned')
  findById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.followUpsService.findByIdAccessible(id, user);
  }

  @Post()
  @RequirePermissions('follow_ups.create')
  create(@Body() dto: CreateFollowUpDto, @CurrentUser() user: RequestUser) {
    return this.followUpsService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('follow_ups.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFollowUpDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.followUpsService.update(id, dto, user);
  }

  @Post(':id/complete')
  @RequirePermissions('follow_ups.complete')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteFollowUpDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.followUpsService.complete(id, dto, user);
  }
}