-- Mark reception paid-consultation invoices so the customer profile can tell a
-- consult fee apart from a service invoice. (The consult fee already nets into the
-- customer's balance automatically, because its paid invoice carries the same
-- lead/client — this flag is purely for labelling / reporting clarity.)
ALTER TABLE "finance"."invoices" ADD COLUMN "isConsultation" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any invoice a paid-consult visit already points at is a consult invoice.
UPDATE "finance"."invoices" i
SET "isConsultation" = true
WHERE EXISTS (
  SELECT 1 FROM "crm"."visits" v
  WHERE v."invoiceId" = i."id" AND v."visitType" = 'PAID_CONSULT'
);
