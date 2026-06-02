-- P4c-2: attestation-authority stamps the parser detected in the OCR text
-- (e.g. {MOFA,HEC}). Suggestion-only hint surfaced next to the manual
-- "Mark attested" control — never auto-marks attestation. Additive + idempotent.

ALTER TABLE "processing"."document_ai_assessments"
  ADD COLUMN IF NOT EXISTS "detectedAuthorities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
