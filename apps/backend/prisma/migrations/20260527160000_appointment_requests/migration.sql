CREATE TABLE "crm"."appointment_requests" (
  "id"                     TEXT PRIMARY KEY,
  "leadId"                 TEXT NOT NULL,
  "threadId"               TEXT,
  "extractedFromMessageId" TEXT,
  "rawText"                TEXT NOT NULL,
  "preferredDay"           TEXT,
  "preferredTime"          TEXT,
  "modality"               TEXT,
  "status"                 TEXT NOT NULL DEFAULT 'PENDING',
  "linkedAppointmentId"    TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"               TIMESTAMP(3),
  "closedByUserId"         TEXT
);
CREATE INDEX "appointment_requests_lead_status_idx"
  ON "crm"."appointment_requests" ("leadId", "status", "createdAt" DESC);
CREATE INDEX "appointment_requests_thread_status_idx"
  ON "crm"."appointment_requests" ("threadId", "status");
