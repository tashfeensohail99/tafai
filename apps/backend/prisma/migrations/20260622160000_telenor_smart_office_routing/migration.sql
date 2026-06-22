-- Telenor Smart Office call-routing.
--   (1) Per-rep PBX extension on employees (set after Telenor activates the
--       account and assigns 3-digit extensions).
--   (2) Our own lightweight inbound-call resolve log — Telenor does not expose
--       CDRs/recordings via API, so this is the only record of who called and
--       which rep we routed them to.
-- Additive only: a new nullable column + a new table. No changes to existing rows.

ALTER TABLE "core"."employees" ADD COLUMN "pbxExtension" VARCHAR(10);

CREATE TABLE "crm"."smart_office_call_logs" (
    "id" TEXT NOT NULL,
    "callerE164" TEXT,
    "callerRaw" TEXT,
    "masterNumber" TEXT,
    "callId" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "leadId" TEXT,
    "clientId" TEXT,
    "agentEmployeeId" TEXT,
    "agentExtension" TEXT,
    "agentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "smart_office_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "smart_office_call_logs_createdAt_idx" ON "crm"."smart_office_call_logs"("createdAt" DESC);
CREATE INDEX "smart_office_call_logs_agentEmployeeId_idx" ON "crm"."smart_office_call_logs"("agentEmployeeId");
