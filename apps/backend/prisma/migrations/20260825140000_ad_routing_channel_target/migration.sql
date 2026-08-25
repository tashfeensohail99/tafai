-- Messenger distribution: a CHANNEL-level ad-routing target so marketing can
-- route ALL leads from a platform (targetId='MESSENGER'|'INSTAGRAM') to a
-- branch/team when no ad- or campaign-level rule matches. Backs the Messenger
-- inbox default (→ Islamabad). Additive + idempotent enum value only.
-- Applied by the user (prisma migrate deploy at boot). Keep re-runnable.

ALTER TYPE "crm"."AdRoutingTargetType" ADD VALUE IF NOT EXISTS 'CHANNEL';
