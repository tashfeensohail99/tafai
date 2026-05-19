import {
  BadRequestException,
  Body,
  Controller,
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
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { ServiceContractsService } from './service-contracts.service';
import {
  AddInstallmentsDto,
  CreateServiceContractDto,
  ListServiceContractsQueryDto,
  UpdateServiceContractDto,
  UploadAgreementDto,
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

  /**
   * Sales-side endpoint: upload the signed agreement PDF along with the
   * total fee. Creates a DRAFT contract with no installments yet — Finance
   * fills those in via POST /:id/installments after reviewing the PDF.
   */
  @Post('upload-agreement')
  @RequireAnyPermissions('leads.update', 'finance.create_invoice')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    }),
  )
  uploadAgreement(
    @Body() dto: UploadAgreementDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('Agreement file is required');
    return this.service.uploadAgreement(dto, file, user.id);
  }

  @Post(':id/installments')
  @RequirePermissions('finance.create_invoice')
  addInstallments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddInstallmentsDto,
  ) {
    return this.service.addInstallments(id, dto);
  }

  @Get(':id/agreement-url')
  @RequirePermissions('finance.view_all')
  getAgreementUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getAgreementDownloadUrl(id);
  }
}
