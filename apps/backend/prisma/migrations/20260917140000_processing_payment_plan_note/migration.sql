-- Processing-side free-text notes about the payment / instalment plan, editable
-- from the case Overview (Suggested Interface, 2026-09). Additive + nullable, so
-- it is a zero-downtime change; existing rows default to NULL.
ALTER TABLE "processing"."processing_cases" ADD COLUMN "paymentPlanNote" TEXT;
