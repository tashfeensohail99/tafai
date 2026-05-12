import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBooleanString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
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

  /** Admin filter: "unassigned" returns only threads with no Lead.assignedEmployeeId. */
  @IsOptional()
  @IsBooleanString()
  @Transform(({ value }) => value === 'true' || value === true)
  unassigned?: boolean;

  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() cursor?: string;
}

class ReassignThreadDto {
  /** The employee to route this thread's lead to. Must be an active WhatsApp inbox member. */
  @IsUUID()
  employeeId!: string;
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
   * Admin override: reassign the thread's Lead to a specific employee. The
   * round-robin engine still applies on the next unassigned inbound, but
   * sticky routing (Lead.preferredEmployeeId) is updated so this becomes the
   * new home for the contact. Permission: whatsapp.reassign.
   */
  @Post(':id/reassign')
  @RequirePermissions('whatsapp.reassign')
  async reassign(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignThreadDto,
  ) {
    const caller = await this.buildCallerContext(user);
    return this.threads.reassign(caller, id, dto.employeeId);
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
