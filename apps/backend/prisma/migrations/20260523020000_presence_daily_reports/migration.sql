-- End-of-day presence accountability snapshots (per agent per day).
CREATE TABLE "core"."presence_daily_reports" (
    "id"             TEXT NOT NULL,
    "employeeId"     TEXT NOT NULL,
    "reportDate"     TEXT NOT NULL,
    "employeeName"   TEXT NOT NULL,
    "awayMinutes"    INTEGER NOT NULL DEFAULT 0,
    "offlineMinutes" INTEGER NOT NULL DEFAULT 0,
    "penaltyApplied" INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "presence_daily_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "presence_daily_reports_employeeId_reportDate_key"
    ON "core"."presence_daily_reports"("employeeId", "reportDate");
CREATE INDEX "presence_daily_reports_reportDate_idx"
    ON "core"."presence_daily_reports"("reportDate");
