-- CaseMilestone: per-case checkable progress steps populated from a
-- per-service-type template at acknowledge time. Independent from the
-- gated ProcessingCaseStage machine — managers control stage transitions;
-- associates tick milestones as they complete the work.

CREATE TABLE "processing"."case_milestones" (
    "id"                TEXT NOT NULL,
    "caseId"            TEXT NOT NULL,
    "title"             VARCHAR(200) NOT NULL,
    "description"       TEXT,
    "sortOrder"         INTEGER NOT NULL DEFAULT 0,
    "completedAt"       TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_milestones_caseId_sortOrder_idx"
    ON "processing"."case_milestones"("caseId", "sortOrder");

ALTER TABLE "processing"."case_milestones"
    ADD CONSTRAINT "case_milestones_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "processing"."case_milestones"
    ADD CONSTRAINT "case_milestones_completedByUserId_fkey"
    FOREIGN KEY ("completedByUserId") REFERENCES "core"."user_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
