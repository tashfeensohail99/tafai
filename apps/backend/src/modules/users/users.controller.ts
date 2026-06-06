import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import {
  AssignRolesDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from './users.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users.view_all')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @RequirePermissions('users.view_all')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermissions('users.create')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: RequestUser) {
    return this.usersService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.update(id, dto, user.id);
  }

  @Post(':id/roles')
  @RequirePermissions('users.assign_role')
  assignRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.assignRoles(id, dto, user.id);
  }

  @Post(':id/deactivate')
  @RequirePermissions('users.deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.deactivate(id, user.id);
  }

  @Post(':id/activate')
  @RequirePermissions('users.deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.activate(id, user.id);
  }

  /**
   * Soft-delete ("Delete" / "Remove" in the admin UI). Removes the user from
   * the users list + employee directory + camera attendance feed and kills
   * their login, while retaining history for audit/payroll. Gated on the same
   * `users.deactivate` permission as deactivate (both revoke all access).
   */
  @Delete(':id')
  @RequirePermissions('users.deactivate')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.remove(id, user.id);
  }

  /**
   * Admin sets a temporary password. The target user is forced to change it
   * on next login. Phase 1 stand-in for a real reset-via-email flow (which
   * needs the email module wired). Permission: `users.update`.
   */
  @Post(':id/reset-password')
  @RequirePermissions('users.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.resetPassword(id, dto.newPassword, user.id);
  }
}
