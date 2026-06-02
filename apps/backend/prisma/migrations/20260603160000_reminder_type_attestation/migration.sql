-- P5-nudges: add ATTESTATION_REMINDER to the ReminderType enum
-- Adding a new enum value in PostgreSQL is safe (no table rewrite).

ALTER TYPE "crm"."ReminderType" ADD VALUE IF NOT EXISTS 'ATTESTATION_REMINDER';
