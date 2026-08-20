import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { HrService } from './hr.service';
import { OnboardEmployeeDto, OffboardEmployeeDto } from './hr.dto';

@Controller('hr')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class HrController {
  constructor(private readonly hr: HrService) {}

  /** Whether business-email generation is available (MXRoute configured). */
  @Get('config')
  @RequirePermissions('hr.view')
  config() {
    return { mailConfigured: this.hr.mailConfigured() };
  }

  /** HR employee directory. */
  @Get('employees')
  @RequirePermissions('hr.view')
  directory(@Query('search') search?: string) {
    return this.hr.directory(search?.trim() || undefined);
  }

  /** Preview the business email a first name would get — creates nothing. */
  @Get('email-suggestion')
  @RequirePermissions('hr.onboard')
  suggestEmail(@Query('firstName') firstName: string) {
    return this.hr.suggestEmail(firstName ?? '');
  }

  /** Create account + employee profile (+ optional mailbox). Returns creds once. */
  @Post('onboard')
  @RequirePermissions('hr.onboard')
  onboard(@Body() dto: OnboardEmployeeDto, @CurrentUser() user: RequestUser) {
    return this.hr.onboard(dto, user.id);
  }

  /** Disable a login (+ optional mailbox delete). */
  @Post('offboard')
  @RequirePermissions('hr.offboard')
  offboard(@Body() dto: OffboardEmployeeDto, @CurrentUser() user: RequestUser) {
    return this.hr.offboard(dto, user.id);
  }
}
