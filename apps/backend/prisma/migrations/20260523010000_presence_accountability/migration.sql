-- Presence accountability: SLA penalty + per-day working-hours accruals + guards.
ALTER TABLE "core"."employees"
  ADD COLUMN "slaPenaltyPoints"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "awayMinutesToday"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "offlineMinutesToday"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "presenceCountersDate" TEXT,
  ADD COLUMN "awayWarnedAt"         TIMESTAMP(3),
  ADD COLUMN "offlinePenalizedDate" TEXT,
  ADD COLUMN "penaltyDecayDate"     TEXT;
