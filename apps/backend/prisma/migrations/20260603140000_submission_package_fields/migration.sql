-- P4e: submission package fields on ProcessingCase
-- AddColumn: storage key, assembled timestamp, doc count

ALTER TABLE "processing"."processing_cases"
  ADD COLUMN "submissionPackageKey" TEXT,
  ADD COLUMN "submissionPackageAssembledAt" TIMESTAMP(3),
  ADD COLUMN "submissionPackageDocCount" INTEGER;
