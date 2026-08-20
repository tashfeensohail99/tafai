import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuditDocumentAccess } from '../../common/decorators/audit-document-access.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JrArtifactsService } from './jr-artifacts.service';
import {
  CarryToRedeterminationDto,
  CounselReviewDto,
  CreateArtifactDto,
  FileArtifactDto,
  ServeArtifactDto,
} from './judicial-review.dto';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * JR artifacts + their versions and the counsel-approval gate (PR 2). Every
 * handler is permission-gated AND re-checks matter-level access in the service
 * (never relies on list scoping alone — #253/#255). Each mutation carries an
 * explicit @Audit decorator because the global interceptor's ID_PARAM_PRIORITY
 * has no `matterId`/`artifactId` — without it the audit row's entityId is null.
 */
@Controller('jr')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrArtifactsController {
  constructor(private readonly artifacts: JrArtifactsService) {}

  // ---- List + create -------------------------------------------------------

  @Get('matters/:matterId/artifacts')
  @RequirePermissions('jr.artifact.view')
  list(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.listGroupedForMatter(matterId, user);
  }

  @Post('matters/:matterId/artifacts')
  @RequirePermissions('jr.artifact.author')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', action: 'RECORD_CREATED', category: 'MUTATION', severity: 'MEDIUM' })
  create(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: CreateArtifactDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.createArtifact(matterId, dto, user);
  }

  // ---- Versions ------------------------------------------------------------

  @Post('artifacts/:artifactId/versions')
  @RequirePermissions('jr.artifact.author')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', category: 'MUTATION', severity: 'MEDIUM' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } }))
  uploadVersion(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('changeNote') changeNote: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.uploadVersion(artifactId, file, user, changeNote);
  }

  @Get('artifacts/:artifactId/versions/:versionId/url')
  @RequirePermissions('jr.artifact.view')
  @AuditDocumentAccess('JrArtifactVersion', 'versionId')
  versionUrl(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.getVersionUrlForUser(artifactId, versionId, user);
  }

  // ---- Lifecycle transitions ----------------------------------------------

  @Post('artifacts/:artifactId/internal-qa')
  @RequirePermissions('jr.artifact.author')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', category: 'MUTATION', severity: 'MEDIUM' })
  internalQa(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.markInternalQa(artifactId, user);
  }

  @Post('artifacts/:artifactId/submit')
  @RequirePermissions('jr.artifact.submit_to_counsel')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', category: 'MUTATION', severity: 'MEDIUM' })
  submit(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.submitToCounsel(artifactId, user);
  }

  @Post('artifacts/:artifactId/counsel-review')
  @RequirePermissions('jr.artifact.record_counsel_review')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', category: 'MUTATION', severity: 'HIGH' })
  counselReview(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Body() dto: CounselReviewDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.recordCounselReview(artifactId, dto, user);
  }

  @Post('artifacts/:artifactId/file')
  @RequirePermissions('jr.artifact.file')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', category: 'MUTATION', severity: 'HIGH' })
  file(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Body() dto: FileArtifactDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.fileArtifact(artifactId, dto, user);
  }

  @Post('artifacts/:artifactId/serve')
  @RequirePermissions('jr.artifact.file')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', category: 'MUTATION', severity: 'HIGH' })
  serve(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Body() dto: ServeArtifactDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.serveArtifact(artifactId, dto, user);
  }

  @Post('artifacts/:artifactId/carry-to-redetermination')
  @RequirePermissions('jr.artifact.author')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', category: 'MUTATION', severity: 'MEDIUM' })
  carryToRedetermination(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Body() dto: CarryToRedeterminationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.carryToRedetermination(artifactId, dto, user);
  }

  @Delete('artifacts/:artifactId')
  @RequirePermissions('jr.artifact.author')
  @Audit({ idParam: 'artifactId', entityType: 'JrArtifact', action: 'RECORD_DELETED', category: 'MUTATION', severity: 'MEDIUM' })
  remove(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.artifacts.softDelete(artifactId, user);
  }

  // ---- Cross-matter counsel queue -----------------------------------------

  @Get('counsel-queue')
  @RequirePermissions('jr.matter.view_all')
  counselQueue() {
    return this.artifacts.counselQueue();
  }
}
