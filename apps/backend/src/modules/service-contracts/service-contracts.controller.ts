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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
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
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 20 }, // 20 MB/file, up to 20 pages
    }),
  )
  uploadAgreement(
    @Body() dto: UploadAgreementDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!files?.length) throw new BadRequestException('Agreement file is required');
    return this.service.uploadAgreement(dto, files, user.id);
  }

  /**
   * Finance uploads the SIGNED agreement PDF onto an existing contract (the
   * one auto-created at approval) → marks contract ACTIVE + agreement SIGNED.
   */
  @Post(':id/upload-signed')
  @RequireAnyPermissions('finance.create_invoice', 'finance.verify_payment', 'settings.manage')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 20 }, // 20 MB/file, up to 20 pages
    }),
  )
  uploadSigned(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!files?.length) throw new BadRequestException('Signed agreement file is required');
    return this.service.uploadSignedToContract(id, files, user.id);
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
