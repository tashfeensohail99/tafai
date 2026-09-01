-- Per-rep daily new-lead cap. NULL = unlimited (the default for everyone).
-- A capped rep still receives leads via round-robin, just at most N per PKT day.
ALTER TABLE "core"."employees" ADD COLUMN "dailyLeadCap" INTEGER;

-- Composite index so the daily-cap COUNT (assignedEmployeeId + createdAt >= PKT
-- midnight) is a bounded range-scan of today's rows, not a scan of a busy rep's
-- whole lead history on every assignment. Plain (non-concurrent) build: the
-- leads table is ~47MB / ~47k rows, so this completes in well under a second.
CREATE INDEX "leads_assignedEmployeeId_createdAt_idx" ON "crm"."leads"("assignedEmployeeId", "createdAt");
