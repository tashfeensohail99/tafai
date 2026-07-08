-- Reception paid-consult: capture the sales rep who referred the visitor. When
-- set, the lead we create for the visit is assigned to this rep (instead of the
-- round-robin), so referred walk-ins land with the rep who brought them in.
ALTER TABLE "crm"."visits" ADD COLUMN "referrerEmployeeId" TEXT;
