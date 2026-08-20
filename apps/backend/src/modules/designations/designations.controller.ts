import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { DesignationsService } from './designations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateDesignationDto, UpdateDesignationDto } from './designations.dto';

// Job titles are managed by HR, and also by admins via settings.
@Controller('designations')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DesignationsController {
  constructor(private readonly service: DesignationsService) {}

  @Get()
  @RequireAnyPermissions('hr.view', 'hr.manage', 'settings.manage', 'employees.view_all')
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @RequireAnyPermissions('hr.manage', 'settings.manage')
  create(@Body() dto: CreateDesignationDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequireAnyPermissions('hr.manage', 'settings.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDesignationDto) {
    return this.service.update(id, dto);
  }
}
