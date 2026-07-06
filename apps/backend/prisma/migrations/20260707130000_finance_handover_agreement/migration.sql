-- Pin a payment handover to the agreement (program) it pays for. A lead can now
-- hold several agreements; without this, invoice resolution during review would
-- attach the payment to whichever agreement is newest, cross-crediting programs.
-- Nullable + indexed; NO FK (agreements are decoupled by id). NULL for legacy /
-- single-agreement handovers, which keep the old "lead's only active invoice"
-- fallback. Not backfilled — historical handovers are already reviewed (their
-- payment is on a specific invoice), so there is nothing to re-resolve.
ALTER TABLE "finance"."finance_handovers" ADD COLUMN "agreementId" TEXT;

CREATE INDEX "finance_handovers_agreementId_idx" ON "finance"."finance_handovers" ("agreementId");
