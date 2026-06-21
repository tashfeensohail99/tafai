import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './devices.dto';
import { NoAudit } from '../../common/decorators/audit.decorator';

/**
 * Per-user device registration for push. JWT-gated only — no permission key,
 * since a user manages their own devices (the service scopes every write to the
 * authenticated userId).
 */
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly service: DevicesService) {}

  /** Register / refresh this device's push token. */
  @NoAudit()
  @Post('register')
  register(@CurrentUser() user: RequestUser, @Body() dto: RegisterDeviceDto) {
    return this.service.register(user.id, dto);
  }

  /** The caller's registered devices. */
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.listForUser(user.id);
  }

  /** Unregister a device token (e.g. on logout). */
  @Delete(':token')
  unregister(@CurrentUser() user: RequestUser, @Param('token') token: string) {
    return this.service.unregister(user.id, token);
  }
}
