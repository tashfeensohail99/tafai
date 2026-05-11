import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { PortalService } from './portal.service';
import { PortalSendMessageDto } from './portal.dto';

/**
 * Client Portal API — all routes under /portal/
 *
 * Authentication: same JWT as the rest of the platform (JwtAuthGuard).
 * Authorisation: PortalService enforces client ownership via email match
 *                (UserAccount.email → Client.email) on every endpoint.
 *                No PermissionGuard here — client users have no permission keys.
 *
 * Security rules enforced in the service:
 * - Client.portalAccessEnabled must be true
 * - Client.status must be ACTIVE
 * - processingCase.clientId must match the resolved client
 * - storageKey is never returned; documents are served via short-lived signed URLs
 * - Internal notes, strategy decisions, and other clients' data are never returned
 */
@Controller('portal')
@UseGuards(JwtAuthGuard)
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  // -------------------------------------------------------------------------
  // CASE
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/mine
   * Returns all processing cases belonging to the authenticated client.
   */
  @Get('cases/mine')
  getMyCases(@CurrentUser() user: RequestUser) {
    return this.portalService.getMyCases(user);
  }

  /**
   * GET /portal/cases/:caseId
   * Case detail — stage, officer, document counts, unread messages.
   */
  @Get('cases/:caseId')
  getCaseDetail(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.portalService.getCaseDetail(caseId, user);
  }

  // -------------------------------------------------------------------------
  // DOCUMENTS
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/:caseId/documents
   * Filtered document checklist — no internal officer notes or reviewer identity.
   */
  @Get('cases/:caseId/documents')
  getDocumentChecklist(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.portalService.getDocumentChecklist(caseId, user);
  }

  /**
   * POST /portal/cases/:caseId/documents/:itemId/upload
   * Client uploads a document (multipart/form-data, field name: "file").
   * Stored in private S3-compatible storage. Returns version metadata.
   *
   * Limits: 10 MB max file size; PDF, JPG, PNG, HEIC accepted.
   * Multer memoryStorage is used so the buffer is available for StorageService.upload().
   */
  @Post('cases/:caseId/documents/:itemId/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard cap at Multer layer
    }),
  )
  uploadDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new Error('No file provided. Use multipart/form-data with field name "file".');
    }
    return this.portalService.uploadDocument(
      caseId,
      itemId,
      file,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  /**
   * GET /portal/cases/:caseId/documents/:itemId/signed-url
   * Issues a short-lived signed URL (default 5 min) for viewing the client's document.
   * Access is logged. storageKey is never exposed.
   */
  @Get('cases/:caseId/documents/:itemId/signed-url')
  getDocumentSignedUrl(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.portalService.getDocumentSignedUrl(
      caseId,
      itemId,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  // -------------------------------------------------------------------------
  // COMMUNICATIONS
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/:caseId/communications
   * Returns filtered message thread (OFFICER↔CLIENT + SYSTEM→CLIENT only).
   * Marks officer messages as read automatically.
   */
  @Get('cases/:caseId/communications')
  getCommunications(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.portalService.getCommunications(caseId, user);
  }

  /**
   * POST /portal/cases/:caseId/communications
   * Client sends a message to their assigned officer.
   */
  @Post('cases/:caseId/communications')
  sendMessage(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: PortalSendMessageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.portalService.sendMessage(caseId, dto, user);
  }

  // -------------------------------------------------------------------------
  // TIMELINE
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/:caseId/timeline
   * Filtered activity timeline — no internal notes, tasks, or officer strategy.
   */
  @Get('cases/:caseId/timeline')
  getTimeline(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.portalService.getTimeline(caseId, user);
  }
}
