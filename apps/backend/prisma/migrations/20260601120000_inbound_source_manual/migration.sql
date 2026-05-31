-- Add MANUAL to InboundDocumentSource.
--
-- Officer/manual document uploads that turn out to be multi-document bundles
-- now surface their extra segments as triage rows; those rows need a source of
-- provenance distinct from WHATSAPP / PORTAL.
--
-- Additive + idempotent. PostgreSQL 12+ permits ALTER TYPE ... ADD VALUE inside
-- the transaction Prisma wraps each migration in, provided the new value is not
-- *used* in the same transaction (it isn't — only added here).
ALTER TYPE "processing"."InboundDocumentSource" ADD VALUE IF NOT EXISTS 'MANUAL';
