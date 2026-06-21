import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { DocumentAccessAuditInterceptor } from '../../common/interceptors/document-access-audit.interceptor';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    // Global interceptors (registered here so they can inject AuditLogService;
    // AuditLogModule is imported by AppModule, so they apply app-wide).
    //
    // DocumentAccessAuditInterceptor: DOCUMENT_VIEWED entry for @AuditDocumentAccess() reads.
    { provide: APP_INTERCEPTOR, useClass: DocumentAccessAuditInterceptor },
    // AuditInterceptor: "capture by default" — every mutation + any @Audit()-tagged
    // route. Fire-and-forget; a cheap no-op on undecorated reads.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
