import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { WhatsAppStatusState } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { WhatsAppStatusService, isStatusFeatureUser } from './status.service';

class CreateStatusDto {
  @IsOptional() @IsString() @MaxLength(700) caption?: string;
  @IsOptional() @IsIn(['DRAFT', 'SCHEDULED', 'POSTED']) initialState?: 'DRAFT' | 'SCHEDULED' | 'POSTED';
  @IsOptional() @IsDateString() scheduledAt?: string;
}

class PatchStatusDto {
  @IsOptional() @IsString() @MaxLength(700) caption?: string;
  @IsOptional() @IsIn(['DRAFT', 'SCHEDULED']) state?: 'DRAFT' | 'SCHEDULED';
  @IsOptional() @IsDateString() scheduledAt?: string;
}

class ListStatusDto {
  @IsOptional() @IsEnum(WhatsAppStatusState) state?: WhatsAppStatusState;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsInt() @Min(1) limit?: number;
}

@Controller('whatsapp/status')
@UseGuards(JwtAuthGuard)
export class WhatsAppStatusController {
  constructor(private readonly svc: WhatsAppStatusService) {}

  /**
   * Whether the current user has the Status tab enabled at all. Frontend
   * calls this on mount to decide whether to show/hide the tab.
   */
  @Get('access')
  access(@CurrentUser() user: RequestUser) {
    return { enabled: isStatusFeatureUser(user) };
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() q: ListStatusDto) {
    return this.svc.list(user, {
      ...(q.state ? { state: q.state } : {}),
      ...(q.search ? { search: q.search } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.findOne(user, id);
  }

  /**
   * Multipart create — field name "file" for the image/video, plus optional
   * text fields: caption, initialState (DRAFT|SCHEDULED|POSTED), scheduledAt.
   * Max upload 100 MB (well above WhatsApp Status caps; UI can enforce lower).
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  create(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateStatusDto,
  ) {
    if (!file) {
      return Promise.reject(new Error('No file uploaded'));
    }
    return this.svc.create(user, {
      file: file.buffer,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      ...(dto.caption ? { caption: dto.caption } : {}),
      ...(dto.initialState ? { state: dto.initialState as WhatsAppStatusState } : {}),
      ...(dto.scheduledAt ? { scheduledAt: new Date(dto.scheduledAt) } : {}),
    });
  }

  @Patch(':id')
  patch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchStatusDto,
  ) {
    return this.svc.patch(user, id, {
      ...(dto.caption !== undefined ? { caption: dto.caption } : {}),
      ...(dto.state ? { state: dto.state as WhatsAppStatusState } : {}),
      ...(dto.scheduledAt !== undefined
        ? { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null }
        : {}),
    });
  }

  @Post(':id/post')
  markPosted(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.markPosted(user, id);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.remove(user, id);
  }
}
