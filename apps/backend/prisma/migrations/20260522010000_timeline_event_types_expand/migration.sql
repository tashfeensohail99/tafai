-- Expand TimelineEventType so the lead profile's Activity tab can render
-- every meaningful touch on a lead, not just the original handful of states.
--
-- Postgres requires each enum value addition to be its own ALTER TYPE,
-- and each ADD VALUE must commit before being used in DDL referencing it.
-- IF NOT EXISTS keeps the migration idempotent across re-runs.

ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'LEAD_STATUS_CHANGED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'LEAD_UPDATED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'LEAD_DELETED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'LEAD_FILE_UPLOADED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'LEAD_FILE_DELETED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'FOLLOW_UP_RESCHEDULED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CANCELLED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'APPOINTMENT_RESCHEDULED';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'APPOINTMENT_NO_SHOW';
