import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBooleanString, IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppThreadsService } from './threads.service';

class ListThreadsDto {
  @IsOptional()
  @IsEnum(['OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED'])
  status?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED';

  @IsOptional()
  @IsBooleanString()
  @Transform(({ value }) => value === 'true' || value === true)
  assignedToMe?: boolean;

  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() cursor?: string;
}

@Controller('whatsapp/threads')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppThreadsController {
  constructor(
    private readonly threads: WhatsAppThreadsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async list(@CurrentUser() user: RequestUser, @Query() q: ListThreadsDto) {
    const caller = await this.buildCallerContext(user);
    return this.threads.list(caller, q);
  }

  @Get(':id')
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const caller = await this.buildCallerContext(user);
    return this.threads.getOrFail(caller, id);
  }

  @HttpCode(204)
  @Post(':id/read')
  @RequirePermissions('whatsapp.view_inbox')
  async markRead(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const caller = await this.buildCallerContext(user);
    await this.threads.markRead(caller, id);
  }

  /**
   * Resolve the calling user's employee row and whether they're allowed to
   * see threads not assigned to them. Permissions are evaluated by the
   * PermissionGuard before this runs, but we still need the role check to
   * scope query results.
   */
  private async buildCallerContext(user: RequestUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const canViewAll = (user.permissions ?? []).includes('whatsapp.view_all_inboxes');
    return {
      userId: user.id,
      employeeId: employee?.id ?? null,
      canViewAll,
    };
  }
}
