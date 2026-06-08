-- Push-notification device registry (core schema).
--
-- One row per (user, device). The mobile/web client registers its FCM token on
-- login and removes it on logout; PushService fans in-app notifications out to
-- these tokens. No FK to user_accounts by design — a token is a disposable
-- transport address, pruned on logout or when FCM reports it stale.
--
-- Pattern matches existing core tables: TEXT UUID primary keys, camelCase
-- columns, snake_case table name via @@map, schema = "core".

DO $$ BEGIN
  CREATE TYPE "core"."DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "core"."device_tokens" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "platform"   "core"."DevicePlatform" NOT NULL,
  "token"      TEXT NOT NULL,
  "deviceInfo" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_token_key"
  ON "core"."device_tokens" ("token");

CREATE INDEX IF NOT EXISTS "device_tokens_userId_idx"
  ON "core"."device_tokens" ("userId");
