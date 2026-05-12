import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AssignLeadDto, ConvertLeadDto, CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';
import { LeadsService } from './leads.service';
import { rowsToCsv, sendCsvDownload, todayStamp } from '../../common/csv/csv.util';

@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @RequireAnyPermissions('leads.view_all', 'leads.view_assigned')
  findAll(
    @Query() query: ListLeadsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.findAllAccessible(query, user);
  }

  /**
   * Stream a CSV of every lead the caller can see. Uses the same filtering as
   * GET / so admins get everything and agents get their own book.
   */
  @Get('export.csv')
  @RequirePermissions('reports.export')
  async exportCsv(
    @Query() query: ListLeadsQueryDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const rows = await this.leadsService.findAllAccessible(query, user);
    const csv = rowsToCsv(rows as Array<Record<string, unknown> & {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string;
      status: string;
      serviceInterest: string | null;
      targetCountry: string | null;
      sourceChannel: string | null;
      assignedEmployee?: { firstName: string; lastName: string } | null;
      branch?: { name: string } | null;
      createdAt: Date;
      convertedAt: Date | null;
    }>, [
      { header: 'Lead ID', value: (r) => r.id },
      { header: 'First name', value: (r) => r.firstName },
      { header: 'Last name', value: (r) => r.lastName },
      { header: 'Email', value: (r) => r.email },
      { header: 'Phone', value: (r) => r.phone },
      { header: 'Status', value: (r) => r.status },
      { header: 'Service', value: (r) => r.serviceInterest },
      { header: 'Target country', value: (r) => r.targetCountry },
      { header: 'Source', value: (r) => r.sourceChannel },
      {
        header: 'Assigned to',
        value: (r) =>
          r.assignedEmployee
            ? `${r.assignedEmployee.firstName} ${r.assignedEmployee.lastName}`.trim()
            : null,
      },
      { header: 'Branch', value: (r) => r.branch?.name ?? null },
      { header: 'Created at', value: (r) => r.createdAt },
      { header: 'Converted at', value: (r) => r.convertedAt },
    ]);
    sendCsvDownload(res, `leads-${todayStamp()}.csv`, csv);
  }

  @Get(':id')
  @RequireAnyPermissions('leads.view_all', 'leads.view_assigned')
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.findByIdAccessible(id, user);
  }

  @Post()
  @RequirePermissions('leads.create')
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: RequestUser) {
    return this.leadsService.create(dto, user.id);
  }

  @Post(':id/assign')
  @RequirePermissions('leads.assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLeadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.assign(id, dto, user.id);
  }

  @Post(':id/convert')
  @RequirePermissions('leads.convert')
  convert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertLeadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.convertToClient(id, user.id, dto.notes);
  }

  @Patch(':id')
  @RequirePermissions('leads.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.update(id, dto, user.id);
  }
}