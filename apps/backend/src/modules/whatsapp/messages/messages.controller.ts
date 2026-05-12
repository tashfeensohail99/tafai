import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppMessagesService } from './messages.service';

class SendTextDto {
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsString() contextWaMessageId?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

class SendTemplateDto {
  @IsString() @MinLength(1) templateName!: string;
  @IsString() @MinLength(2) language!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  components?: Array<Record<string, unknown>>;
  @IsOptional() @IsString() idempotencyKey?: string;
}

@Controller('whatsapp/threads/:threadId/messages')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppMessagesController {
  constructor(
    private readonly messages: WhatsAppMessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async list(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('before') before: string | undefined,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.listForThread(caller, threadId, {
      ...(before ? { before: new Date(before) } : {}),
    });
  }

  @Post('text')
  @RequirePermissions('whatsapp.send_message')
  async sendText(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendTextDto,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.sendText(caller, { threadId, ...dto });
  }

  @Post('template')
  @RequirePermissions('whatsapp.send_message')
  async sendTemplate(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendTemplateDto,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.sendTemplate(caller, { threadId, ...dto });
  }

  private async callerContext(user: RequestUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const canViewAll = (user.permissions ?? []).includes('whatsapp.view_all_inboxes');
    return { userId: user.id, employeeId: employee?.id ?? null, canViewAll };
  }
}
