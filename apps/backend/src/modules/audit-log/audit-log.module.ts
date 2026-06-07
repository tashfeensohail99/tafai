import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { DocumentAccessAuditInterceptor } from '../../common/interceptors/document-access-audit.interceptor';

@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    // Global interceptor: records a DOCUMENT_VIEWED audit entry for any route
    // tagged with @AuditDocumentAccess(). Registered here so it can inject
    // AuditLogService; AuditLogModule is imported by AppModule, so it applies
    // app-wide (a cheap no-op on every undecorated route).
    { provide: APP_INTERCEPTOR, useClass: DocumentAccessAuditInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
