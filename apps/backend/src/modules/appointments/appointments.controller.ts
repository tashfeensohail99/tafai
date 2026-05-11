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
import { AppointmentsService } from './appointments.service';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentDto,
} from './appointments.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  findAll(
    @Query() query: ListAppointmentsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.findAllAccessible(query, user);
  }

  @Get(':id')
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.findByIdAccessible(id, user);
  }

  @Post()
  @RequirePermissions('appointments.create')
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('appointments.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.update(id, dto, user.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('appointments.cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentsService.cancel(id, dto, user.id);
  }
}