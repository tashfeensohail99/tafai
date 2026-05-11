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
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';

// Org ID will come from config/context in production; for now read from env
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID ?? '';

@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @RequirePermissions('settings.manage')
  findAll() {
    return this.departmentsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('settings.manage')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.departmentsService.findById(id);
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: RequestUser) {
    return this.departmentsService.create(dto, user.id, DEFAULT_ORG_ID);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.departmentsService.update(id, dto, user.id);
  }
}
