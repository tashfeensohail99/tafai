-- Reception paid-consult: WhatsApp opt-in consent + customer-notification outcome.
ALTER TABLE "crm"."visits" ADD COLUMN "whatsappConsent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "crm"."visitor_payments" ADD COLUMN "notifyStatus" TEXT;
ALTER TABLE "crm"."visitor_payments" ADD COLUMN "notifyAt" TIMESTAMP(3);
