-- Soft-delete support for LeadImportBatch. Mirrors the deletedAt pattern
-- already used on Lead, Client, Employee, UserAccount. The admin "delete
-- batch" action stamps this column + cascades to set deletedAt on every
-- Lead the batch created; both stay queryable for forensics but are
-- hidden from default list endpoints by `WHERE "deletedAt" IS NULL`.

ALTER TABLE "crm"."lead_import_batches"
  ADD COLUMN "deletedAt" TIMESTAMP(3);
