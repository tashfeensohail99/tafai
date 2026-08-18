import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JrArtifactsService } from './jr-artifacts.service';

/**
 * JR artifacts + their versions. PR 1 exposes the read surface (list a matter's
 * artifacts, mint a signed URL for a version's file). The lifecycle transitions
 * — submit-to-counsel, record-counsel-review, file, serve — land in PR 2. Every
 * handler is permission-gated.
 */
@Controller('jr')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrArtifactsController {
  constructor(private readonly artifacts: JrArtifactsService) {}

  @Get('matters/:matterId/artifacts')
  @RequirePermissions('jr.artifact.view')
  list(@Param('matterId', ParseUUIDPipe) matterId: string) {
    return this.artifacts.listForMatter(matterId);
  }

  @Get('artifact-versions/:versionId/url')
  @RequirePermissions('jr.artifact.view')
  versionUrl(@Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.artifacts.getVersionUrl(versionId);
  }
}
