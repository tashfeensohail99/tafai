-- P4f: translation-needed detection
-- AddColumn: dominant non-Latin script hint on DocumentAiAssessment

ALTER TABLE "processing"."document_ai_assessments"
  ADD COLUMN "detectedLanguage" TEXT;
