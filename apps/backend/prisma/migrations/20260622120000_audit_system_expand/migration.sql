-- Audit system: structured classification on audit_logs (Phase 0).
-- Fully additive + backward-compatible: new enum types, new generic AuditAction
-- values, and new NULLABLE columns + indexes. Existing rows and existing code
-- are unaffected (old code simply never reads/writes the new columns).

-- CreateEnum
CREATE TYPE "audit"."AuditSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "audit"."AuditCategory" AS ENUM ('MUTATION', 'READ', 'AUTH', 'EXPORT', 'FILE_ACCESS', 'WEBHOOK', 'CRON', 'CONFIG');

-- AlterEnum: generic actions auto-derived by the global AuditInterceptor
ALTER TYPE "audit"."AuditAction" ADD VALUE 'RECORD_CREATED';
ALTER TYPE "audit"."AuditAction" ADD VALUE 'RECORD_UPDATED';
ALTER TYPE "audit"."AuditAction" ADD VALUE 'RECORD_DELETED';
ALTER TYPE "audit"."AuditAction" ADD VALUE 'DATA_EXPORTED';
ALTER TYPE "audit"."AuditAction" ADD VALUE 'SENSITIVE_READ';
ALTER TYPE "audit"."AuditAction" ADD VALUE 'ACCESS_DENIED';

-- AlterTable
ALTER TABLE "audit"."audit_logs"
  ADD COLUMN "severity" "audit"."AuditSeverity",
  ADD COLUMN "category" "audit"."AuditCategory",
  ADD COLUMN "method" TEXT,
  ADD COLUMN "route" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "statusCode" INTEGER,
  ADD COLUMN "durationMs" INTEGER;

-- CreateIndex
CREATE INDEX "audit_logs_severity_createdAt_idx" ON "audit"."audit_logs"("severity", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_category_createdAt_idx" ON "audit"."audit_logs"("category", "createdAt");
