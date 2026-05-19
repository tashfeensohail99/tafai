import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { ServiceContractsService } from './service-contracts.service';
import {
  CreateServiceContractDto,
  ListServiceContractsQueryDto,
  UpdateServiceContractDto,
} from './service-contracts.dto';

@Controller('finance/service-contracts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ServiceContractsController {
  constructor(private readonly service: ServiceContractsService) {}

  @Get()
  @RequirePermissions('finance.view_all')
  findAll(@Query() query: ListServiceContractsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('finance.view_all')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('finance.create_invoice')
  create(@Body() dto: CreateServiceContractDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('finance.create_invoice')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceContractDto,
  ) {
    return this.service.update(id, dto);
  }

  @Post('installments/:installmentId/generate-invoice')
  @RequirePermissions('finance.create_invoice')
  generateInvoice(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.generateInvoiceForInstallment(installmentId, user.id);
  }
}
