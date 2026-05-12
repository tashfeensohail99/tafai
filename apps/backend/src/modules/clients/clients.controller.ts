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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { ClientsService } from './clients.service';
import { CreateClientDto, ListClientsQueryDto, UpdateClientDto } from './clients.dto';
import { rowsToCsv, sendCsvDownload, todayStamp } from '../../common/csv/csv.util';

@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @RequirePermissions('clients.view_all')
  findAll(@Query() query: ListClientsQueryDto) {
    return this.clientsService.findAll(query);
  }

  @Get('export.csv')
  @RequirePermissions('reports.export')
  async exportCsv(@Query() query: ListClientsQueryDto, @Res() res: Response): Promise<void> {
    const rows = (await this.clientsService.findAll(query)) as Array<{
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string;
      status: string;
      nationality: string | null;
      serviceType: string | null;
      targetCountry: string | null;
      portalAccessEnabled: boolean;
      assignedEmployee?: { firstName: string; lastName: string } | null;
      branch?: { name: string } | null;
      createdAt: Date;
    }>;
    const csv = rowsToCsv(rows, [
      { header: 'Client ID', value: (r) => r.id },
      { header: 'First name', value: (r) => r.firstName },
      { header: 'Last name', value: (r) => r.lastName },
      { header: 'Email', value: (r) => r.email },
      { header: 'Phone', value: (r) => r.phone },
      { header: 'Status', value: (r) => r.status },
      { header: 'Nationality', value: (r) => r.nationality },
      { header: 'Service', value: (r) => r.serviceType },
      { header: 'Target country', value: (r) => r.targetCountry },
      { header: 'Portal access', value: (r) => (r.portalAccessEnabled ? 'enabled' : 'disabled') },
      {
        header: 'Assigned sales rep',
        value: (r) =>
          r.assignedEmployee
            ? `${r.assignedEmployee.firstName} ${r.assignedEmployee.lastName}`.trim()
            : null,
      },
      { header: 'Branch', value: (r) => r.branch?.name ?? null },
      { header: 'Created at', value: (r) => r.createdAt },
    ]);
    sendCsvDownload(res, `clients-${todayStamp()}.csv`, csv);
  }

  @Get(':id')
  @RequirePermissions('clients.view_all')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.findById(id);
  }

  @Post()
  @RequirePermissions('clients.create')
  create(@Body() dto: CreateClientDto, @CurrentUser() user: RequestUser) {
    return this.clientsService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('clients.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.clientsService.update(id, dto, user.id);
  }
}