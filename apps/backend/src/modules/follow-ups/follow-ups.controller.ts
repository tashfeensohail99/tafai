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

  @Get()
  @RequireAnyPermissions('follow_ups.view_all', 'follow_ups.view_assigned')
  findAll(@Query() query: ListFollowUpsQueryDto, @CurrentUser() user: RequestUser) {
    return this.followUpsService.findAllAccessible(query, user);
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