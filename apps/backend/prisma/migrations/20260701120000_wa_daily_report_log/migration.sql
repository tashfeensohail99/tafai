-- Idempotency + history marker for the 8 AM daily WhatsApp activity report.
-- One row per PKT day the report covers, so a backend restart can't re-email
-- the whole team twice. Additive only: a brand-new table.

CREATE TABLE "whatsapp"."daily_report_log" (
    "reportDate" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "texted" INTEGER NOT NULL DEFAULT 0,
    "replied" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "daily_report_log_pkey" PRIMARY KEY ("reportDate")
);
