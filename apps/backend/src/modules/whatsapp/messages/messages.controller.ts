import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
    @Query('after') after: string | undefined,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.listForThread(caller, threadId, {
      ...(before ? { before: new Date(before) } : {}),
      ...(after ? { after: new Date(after) } : {}),
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

  /**
   * Upload and send a media message (audio/image/video/document).
   * Multipart form-data: field name = "file", optional "caption" text field.
   * Max upload size is controlled by the NestJS / Express body-parser limits.
   *
   * Meta supports audio/ogg, audio/mpeg, audio/aac, audio/mp4, audio/amr,
   * image/jpeg, image/png, image/webp, video/mp4, video/3gp, and common
   * document types (application/pdf, etc.).
   */
  @Post('media')
  @RequirePermissions('whatsapp.send_message')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB — Meta's hard limit
    }),
  )
  async sendMedia(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('caption') caption?: string,
    @Body('idempotencyKey') idempotencyKey?: string,
  ) {
    if (!file) {
      return { error: 'No file uploaded' };
    }
    const caller = await this.callerContext(user);
    return this.messages.sendMediaMessage(caller, {
      threadId,
      file: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
      caption: caption?.trim() || undefined,
      idempotencyKey,
    });
  }

  private async callerContext(user: RequestUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const perms = user.permissions ?? [];
    const canViewAll = perms.includes('whatsapp.view_all_inboxes');
    // Finance closed-loop scope (see threads.controller.ts for rationale).
    const canViewFinanceScope = !canViewAll && perms.includes('whatsapp.view_finance_scope');
    return { userId: user.id, employeeId: employee?.id ?? null, canViewAll, canViewFinanceScope };
  }
}
