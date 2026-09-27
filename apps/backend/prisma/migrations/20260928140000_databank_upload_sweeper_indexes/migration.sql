-- Databank Phase 1, step 5 (upload sweeper): indexes for the sweeper's pending-cleanup
-- scan and the orphan reconcile's lookup by R2 uploadId. Generated with prisma migrate diff;
-- purely additive (two indexes on the new databank_uploads table).

-- CreateIndex
CREATE INDEX "databank_uploads_r2CleanedAt_updatedAt_idx" ON "processing"."databank_uploads"("r2CleanedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "databank_uploads_r2UploadId_idx" ON "processing"."databank_uploads"("r2UploadId");

