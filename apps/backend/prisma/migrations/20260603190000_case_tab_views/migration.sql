-- Per-user, per-case "last viewed" timestamp for each workspace tab.
-- Powers the new-item count badges on the case workspace.

-- CreateTable
CREATE TABLE "processing"."case_tab_views" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tab" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_tab_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_tab_views_caseId_userId_idx" ON "processing"."case_tab_views"("caseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "case_tab_views_caseId_userId_tab_key" ON "processing"."case_tab_views"("caseId", "userId", "tab");
