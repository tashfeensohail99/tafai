-- Migration: Lead → Client identity hardening
--
-- 1. Extend ClientStatus enum with portal-friendly summary values
-- 2. Add new Client columns: cnic, sourceLeadId, assignedEmployeeId, serviceType, targetCountry
-- 3. Backfill the new columns from each Client's source Lead (where convertedClientId pointed back)
-- 4. Backfill ProcessingCase.clientId for any rows still NULL (creates a missing Client from the Lead if needed)
-- 5. Enforce ProcessingCase.clientId NOT NULL
--
-- IMPORTANT: each ALTER TYPE ADD VALUE is issued before any DML that uses the new
-- value so we don't hit the "unsafe use of new value" error inside the migration
-- transaction.

-- -------------------------------------------------------------------------
-- 1. Expand ClientStatus
-- -------------------------------------------------------------------------
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'NEW_CLIENT';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'DOCUMENTS_PENDING';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'UNDER_PROCESSING';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'CLOSED';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "crm"."ClientStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

-- -------------------------------------------------------------------------
-- 2. New columns on clients
-- -------------------------------------------------------------------------
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "cnic" TEXT;
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "sourceLeadId" TEXT;
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "assignedEmployeeId" TEXT;
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "serviceType" TEXT;
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "targetCountry" TEXT;

-- Foreign keys (deferred so the column add and backfill can happen first).
ALTER TABLE "crm"."clients"
  ADD CONSTRAINT "clients_sourceLeadId_fkey"
  FOREIGN KEY ("sourceLeadId") REFERENCES "crm"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm"."clients"
  ADD CONSTRAINT "clients_assignedEmployeeId_fkey"
  FOREIGN KEY ("assignedEmployeeId") REFERENCES "core"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "clients_sourceLeadId_idx" ON "crm"."clients"("sourceLeadId");
CREATE INDEX IF NOT EXISTS "clients_assignedEmployeeId_idx" ON "crm"."clients"("assignedEmployeeId");

-- -------------------------------------------------------------------------
-- 3. Backfill clients from the lead they came from
-- -------------------------------------------------------------------------
UPDATE "crm"."clients" c
SET
  "sourceLeadId"       = COALESCE(c."sourceLeadId", l.id),
  "assignedEmployeeId" = COALESCE(c."assignedEmployeeId", l."assignedEmployeeId"),
  "serviceType"        = COALESCE(c."serviceType", l."serviceInterest"),
  "targetCountry"      = COALESCE(c."targetCountry", l."targetCountry")
FROM "crm"."leads" l
WHERE l."convertedClientId" = c.id;

-- -------------------------------------------------------------------------
-- 4. Backfill ProcessingCase.clientId
-- -------------------------------------------------------------------------
-- 4a. If the lead is already converted, copy the existing client id.
UPDATE "processing"."processing_cases" pc
SET "clientId" = l."convertedClientId"
FROM "crm"."leads" l
WHERE pc."leadId" = l.id
  AND pc."clientId" IS NULL
  AND l."convertedClientId" IS NOT NULL;

-- 4b. For any case whose lead was never converted, create a Client now.
-- Phone is the unique key on Client, so we use phone-match to avoid duplicates.
WITH unconverted AS (
  SELECT pc.id AS case_id, l.*
  FROM "processing"."processing_cases" pc
  JOIN "crm"."leads" l ON l.id = pc."leadId"
  WHERE pc."clientId" IS NULL
), inserted AS (
  INSERT INTO "crm"."clients" (
    id, "branchId", "createdByUserId",
    "firstName", "lastName", email, phone,
    "alternatePhone", nationality, status, "portalAccessEnabled",
    "sourceLeadId", "assignedEmployeeId", "serviceType", "targetCountry",
    "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid(),
    u."branchId",
    u."createdByUserId",
    u."firstName",
    u."lastName",
    u.email,
    u.phone,
    u."alternatePhone",
    u.nationality,
    'NEW_CLIENT'::"crm"."ClientStatus",
    true,
    u.id,
    u."assignedEmployeeId",
    u."serviceInterest",
    u."targetCountry",
    NOW(),
    NOW()
  FROM unconverted u
  WHERE NOT EXISTS (SELECT 1 FROM "crm"."clients" cc WHERE cc.phone = u.phone)
  RETURNING id, "sourceLeadId"
)
UPDATE "crm"."leads" lu
SET "convertedClientId" = i.id, "convertedAt" = NOW(), status = 'CONVERTED'::"crm"."LeadStatus"
FROM inserted i
WHERE lu.id = i."sourceLeadId" AND lu."convertedClientId" IS NULL;

-- 4c. For phone-match collisions (a Client already existed for that phone), link.
UPDATE "crm"."leads" l
SET "convertedClientId" = c.id, "convertedAt" = COALESCE(l."convertedAt", NOW()), status = 'CONVERTED'::"crm"."LeadStatus"
FROM "crm"."clients" c
WHERE l.phone = c.phone
  AND l."convertedClientId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "processing"."processing_cases" pc
    WHERE pc."leadId" = l.id AND pc."clientId" IS NULL
  );

-- 4d. Final pass to fill clientId from the (now-set) convertedClientId.
UPDATE "processing"."processing_cases" pc
SET "clientId" = l."convertedClientId"
FROM "crm"."leads" l
WHERE pc."leadId" = l.id
  AND pc."clientId" IS NULL
  AND l."convertedClientId" IS NOT NULL;

-- -------------------------------------------------------------------------
-- 5. Enforce NOT NULL on ProcessingCase.clientId
-- -------------------------------------------------------------------------
-- If any rows remain NULL we let this fail loudly — that would mean a case
-- exists whose Lead can't be safely converted (likely a data anomaly we want
-- to investigate, not paper over).
ALTER TABLE "processing"."processing_cases" ALTER COLUMN "clientId" SET NOT NULL;

-- Default status for new Clients changes from ACTIVE to NEW_CLIENT.
ALTER TABLE "crm"."clients" ALTER COLUMN "status" SET DEFAULT 'NEW_CLIENT';
