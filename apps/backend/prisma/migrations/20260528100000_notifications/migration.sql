CREATE TABLE "core"."notifications" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "core"."user_accounts"("id") ON DELETE CASCADE,
  "type"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "link"      TEXT,
  "read"      BOOLEAN NOT NULL DEFAULT false,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "notifications_user_read_created_idx"
  ON "core"."notifications" ("userId", "read", "createdAt" DESC);
CREATE INDEX "notifications_created_idx"
  ON "core"."notifications" ("createdAt" DESC);
