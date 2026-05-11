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
import { EmployeesService } from './employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employees.dto';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @RequirePermissions('employees.view_all')
  findAll() {
    return this.employeesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('employees.view_all')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.findById(id);
  }

  @Post()
  @RequirePermissions('employees.create')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('employees.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.employeesService.update(id, dto, user.id);
  }
}
