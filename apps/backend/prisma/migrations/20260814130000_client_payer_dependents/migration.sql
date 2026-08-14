-- Family / multiple applicants under one payer.
-- Additive + idempotent.

-- 1) phone becomes optional so a DEPENDENT applicant (who shares the payer's
--    contact) needs no phone of its own. The UNIQUE constraint stays — Postgres
--    permits many NULLs under a unique index, so phone -> client resolution
--    stays unambiguous (dependents simply aren't phone-reachable).
ALTER TABLE "crm"."clients" ALTER COLUMN "phone" DROP NOT NULL;

-- 2) payer -> dependent applicants self-link.
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "payerClientId" TEXT;
CREATE INDEX IF NOT EXISTS "clients_payerClientId_idx" ON "crm"."clients"("payerClientId");
DO $$ BEGIN
  ALTER TABLE "crm"."clients"
    ADD CONSTRAINT "clients_payerClientId_fkey"
    FOREIGN KEY ("payerClientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
