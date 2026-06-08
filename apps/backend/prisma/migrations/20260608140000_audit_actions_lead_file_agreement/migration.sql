-- New AuditAction values for lead-file attachments + agreement lifecycle, so
-- these events land in the audit trail (data-access forensics).
--
-- ALTER TYPE ... ADD VALUE is idempotent here via IF NOT EXISTS and only ADDS
-- values (never uses them in this migration), so it is safe to run in Prisma's
-- migration transaction on PostgreSQL 12+.

ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_FILE_UPLOADED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_FILE_DELETED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'AGREEMENT_STATUS_CHANGED';
