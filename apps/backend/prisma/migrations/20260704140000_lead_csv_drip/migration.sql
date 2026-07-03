-- CSV auto-drip state on leads (additive, nullable — safe/online).
-- Two-touch WhatsApp template drip fired when a lead enters via CSV import.
ALTER TABLE "crm"."leads"
  ADD COLUMN "dripTouch1At"      TIMESTAMP(3),
  ADD COLUMN "dripTouch2At"      TIMESTAMP(3),
  ADD COLUMN "dripSkippedReason" TEXT;
