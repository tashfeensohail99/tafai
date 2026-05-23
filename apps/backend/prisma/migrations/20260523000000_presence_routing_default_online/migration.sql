-- Presence becomes a routing gate: Away/Offline agents get no NEW leads (but
-- keep their existing chats). Default new agents to ONLINE so they receive
-- leads unless they deliberately opt out, and bring every current (non-deleted)
-- agent to ONLINE for a clean launch of the feature.
ALTER TABLE "core"."employees" ALTER COLUMN "presenceStatus" SET DEFAULT 'ONLINE';
UPDATE "core"."employees" SET "presenceStatus" = 'ONLINE' WHERE "deletedAt" IS NULL;
