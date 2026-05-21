import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { LeadImportsService } from './lead-imports.service';

@Controller('admin/lead-imports')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeadImportsController {
  constructor(private readonly service: LeadImportsService) {}

  /**
   * Stateless parse-only endpoint. Admin uploads a file, gets back the
   * detected headers + first 10 rows + a best-guess column mapping. They
   * can iterate on the mapping client-side until it looks right, then
   * trigger the actual import via the (not-yet-built) POST /
   */
  @Post('preview')
  @RequirePermissions('leads.create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    }),
  )
  preview(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('A CSV or Excel file is required.');
    return this.service.preview(file);
  }
}
