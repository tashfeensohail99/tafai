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
import { DocumentsService } from './documents.service';
import {
  CreateClientDocumentDto,
  CreateDocumentRequirementDto,
  ListClientDocumentsQueryDto,
  ListDocumentRequirementsQueryDto,
  ReviewClientDocumentDto,
  UpdateDocumentRequirementDto,
} from './documents.dto';

@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('requirements')
  @RequirePermissions('documents.view_all')
  listRequirements(@Query() query: ListDocumentRequirementsQueryDto) {
    return this.documentsService.listRequirements(query);
  }

  @Post('requirements')
  @RequirePermissions('settings.manage')
  createRequirement(@Body() dto: CreateDocumentRequirementDto, @CurrentUser() user: RequestUser) {
    return this.documentsService.createRequirement(dto, user.id);
  }

  @Patch('requirements/:id')
  @RequirePermissions('settings.manage')
  updateRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentRequirementDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documentsService.updateRequirement(id, dto, user.id);
  }

  @Get()
  @RequirePermissions('documents.view_all')
  listDocuments(@Query() query: ListClientDocumentsQueryDto) {
    return this.documentsService.listDocuments(query);
  }

  @Get(':id')
  @RequirePermissions('documents.view_all')
  findDocumentById(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.findDocumentById(id);
  }

  @Post()
  @RequirePermissions('documents.upload')
  uploadDocument(@Body() dto: CreateClientDocumentDto, @CurrentUser() user: RequestUser) {
    return this.documentsService.uploadDocument(dto, user.id);
  }

  @Post(':id/review')
  @RequirePermissions('documents.verify')
  reviewDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewClientDocumentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documentsService.reviewDocument(id, dto, user.id);
  }
}