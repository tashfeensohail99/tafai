-- Messenger / Instagram groundwork: a platform discriminator on channels +
-- threads so the same WhatsApp inbox tables can also carry Facebook Messenger and
-- Instagram Direct. Purely ADDITIVE + IDEMPOTENT — every existing row defaults to
-- WHATSAPP, so there is NO behaviour change. Adding a NOT NULL column with a
-- constant default is a metadata-only op on PG11+ (no table rewrite).
-- Applied by the user (prisma migrate deploy at boot). Keep re-runnable.

-- ── 1. ChannelPlatform enum (whatsapp schema) ─────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "whatsapp"."ChannelPlatform" AS ENUM ('WHATSAPP', 'MESSENGER', 'INSTAGRAM');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── 2. channels.platform + channels.pageId ────────────────────────────────────
ALTER TABLE "whatsapp"."channels"
  ADD COLUMN IF NOT EXISTS "platform" "whatsapp"."ChannelPlatform" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "whatsapp"."channels"
  ADD COLUMN IF NOT EXISTS "pageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "channels_pageId_key" ON "whatsapp"."channels"("pageId");

-- ── 3. threads.platform + supporting index ────────────────────────────────────
ALTER TABLE "whatsapp"."threads"
  ADD COLUMN IF NOT EXISTS "platform" "whatsapp"."ChannelPlatform" NOT NULL DEFAULT 'WHATSAPP';
CREATE INDEX IF NOT EXISTS "threads_platform_lastHumanActivityAt_idx"
  ON "whatsapp"."threads"("platform", "lastHumanActivityAt" DESC);
