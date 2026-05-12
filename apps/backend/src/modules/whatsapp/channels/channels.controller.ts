import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { WhatsAppChannelStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { WhatsAppChannelsService } from './channels.service';

class UpsertChannelDto {
  @IsString() @MinLength(1) label!: string;
  @IsString() @MinLength(1) wabaId!: string;
  @IsString() @MinLength(1) phoneNumberId!: string;
  @IsString() @MinLength(1) displayNumber!: string;
  @IsString() @MinLength(20) accessToken!: string;
}

class UpdateChannelStatusDto {
  @IsEnum(WhatsAppChannelStatus) status!: WhatsAppChannelStatus;
  @IsOptional() @IsString() reason?: string;
}

/**
 * Admin-only endpoints for managing WhatsApp Business numbers. The token is
 * encrypted before storage; we never return it.
 *
 * Routes (auto-prefixed with /v1 by the global prefix):
 *   GET    /whatsapp/channels
 *   POST   /whatsapp/channels           upsert by phone_number_id
 *   PATCH  /whatsapp/channels/:id/status
 */
@Controller('whatsapp/channels')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppChannelsController {
  constructor(private readonly channels: WhatsAppChannelsService) {}

  @Get()
  @RequirePermissions('whatsapp.manage_channels')
  async list() {
    return this.channels.list();
  }

  @Post()
  @RequirePermissions('whatsapp.manage_channels')
  async upsert(@CurrentUser() user: RequestUser, @Body() dto: UpsertChannelDto) {
    return this.channels.upsert(user.id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('whatsapp.manage_channels')
  async setStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelStatusDto,
  ) {
    return this.channels.setStatus(user.id, id, dto.status);
  }
}
