-- Advisory OCR-read currency of the uploaded receipt (P4c). Nullable, additive.
ALTER TABLE "crm"."visitor_payments" ADD COLUMN "ocrCurrency" TEXT;
