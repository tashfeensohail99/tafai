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
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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
import { TemplateComponentDto } from './template-component.dto';
import { Audit } from '../../../common/decorators/audit.decorator';

class SendTextDto {
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsString() contextWaMessageId?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

class SendTemplateDto {
  @IsString() @MinLength(1) templateName!: string;
  @IsString() @MinLength(2) language!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TemplateComponentDto)
  components?: TemplateComponentDto[];
  @IsOptional() @IsString() idempotencyKey?: string;
}

class SendReactionDto {
  /** wa_message_id of the message being reacted to. */
  @IsString() @MinLength(1) targetWaMessageId!: string;
  @IsString() @MinLength(1) emoji!: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

class SendLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

class ContactCardDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(3) phone!: string;
}

class SendContactDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactCardDto)
  contacts!: ContactCardDto[];
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

  @Audit({ entityType: 'WhatsAppThread', category: 'MUTATION', severity: 'HIGH', idParam: 'threadId', action: 'WHATSAPP_MESSAGE_SENT' })
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

  @Audit({ entityType: 'WhatsAppThread', category: 'MUTATION', severity: 'HIGH', idParam: 'threadId', action: 'WHATSAPP_MESSAGE_SENT' })
  @Post('template')
  @RequirePermissions('whatsapp.send_message')
  async sendTemplate(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendTemplateDto,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.sendTemplate(caller, {
      threadId,
      ...dto,
      // Validated nested DTO instances — structurally the Meta components JSON.
      components: dto.components as unknown as Array<Record<string, unknown>> | undefined,
    });
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
  @Audit({ entityType: 'WhatsAppThread', category: 'MUTATION', severity: 'HIGH', idParam: 'threadId', action: 'WHATSAPP_MESSAGE_SENT' })
  @Post('media')
  @RequirePermissions('whatsapp.send_message')
  @UseInterceptors(
    FileInterceptor('file', {
      // 100 MB ingestion cap — NOT the WhatsApp limit. Meta caps inline video
      // at 16 MB, but the service compresses oversized videos down to fit, so
      // the raw (large) file must be allowed IN to be compressed. 100 MB also
      // matches Meta's document ceiling (large PDFs now go through too). The
      // service still enforces the real per-type limits after processing.
      limits: { fileSize: 100 * 1024 * 1024 },
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

  /**
   * Re-send a media message we already hold in storage. WhatsApp purges its
   * server copy after delivery, so when the recipient's phone drops the local
   * file they get "no longer available — ask the sender to re-send." We still
   * have the file, so this pushes it out again without re-uploading.
   */
  @Audit({ entityType: 'WhatsAppThread', category: 'MUTATION', severity: 'HIGH', idParam: 'threadId', action: 'WHATSAPP_MESSAGE_SENT' })
  @Post('media/:messageId/resend')
  @RequirePermissions('whatsapp.send_message')
  async resendMedia(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.resendMedia(caller, { threadId, messageId });
  }

  /** React to a customer message with an emoji. */
  @Audit({ entityType: 'WhatsAppThread', category: 'MUTATION', severity: 'HIGH', idParam: 'threadId', action: 'WHATSAPP_MESSAGE_SENT' })
  @Post('reaction')
  @RequirePermissions('whatsapp.send_message')
  async sendReaction(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendReactionDto,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.sendReaction(caller, { threadId, ...dto });
  }

  /** Send a pin-drop location. */
  @Audit({ entityType: 'WhatsAppThread', category: 'MUTATION', severity: 'HIGH', idParam: 'threadId', action: 'WHATSAPP_MESSAGE_SENT' })
  @Post('location')
  @RequirePermissions('whatsapp.send_message')
  async sendLocation(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendLocationDto,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.sendLocation(caller, { threadId, ...dto });
  }

  /** Send one or more contact cards. */
  @Audit({ entityType: 'WhatsAppThread', category: 'MUTATION', severity: 'HIGH', idParam: 'threadId', action: 'WHATSAPP_MESSAGE_SENT' })
  @Post('contact')
  @RequirePermissions('whatsapp.send_message')
  async sendContact(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendContactDto,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.sendContact(caller, { threadId, ...dto });
  }

  private async callerContext(user: RequestUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const perms = user.permissions ?? [];
    const canViewAll = perms.includes('whatsapp.view_all_inboxes');
    // Finance + Processing closed-loop scopes (see threads.controller.ts).
    const canViewFinanceScope = !canViewAll && perms.includes('whatsapp.view_finance_scope');
    const canViewProcessingScope = !canViewAll && perms.includes('whatsapp.view_processing_scope');
    return { userId: user.id, employeeId: employee?.id ?? null, canViewAll, canViewFinanceScope, canViewProcessingScope };
  }
}
