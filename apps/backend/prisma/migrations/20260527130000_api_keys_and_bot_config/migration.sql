-- Bot enablement config on Organization
ALTER TABLE "core"."organizations" ADD COLUMN "botEnabledAt" TIMESTAMP(3);
ALTER TABLE "core"."organizations" ADD COLUMN "botMode" TEXT NOT NULL DEFAULT 'AUTO';

-- Encrypted third-party API keys (OpenAI etc.) — single source of truth
-- managed via the admin "API Keys" tab. Plaintext is never stored;
-- `keyEnc` is AES-256-GCM ciphertext, `keyTail` is the last 4 chars for
-- a masked UI preview.
CREATE TABLE "core"."api_keys" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "core"."organizations"("id") ON DELETE CASCADE,
  "provider"        TEXT NOT NULL,
  "label"           TEXT NOT NULL,
  "keyEnc"          TEXT NOT NULL,
  "keyTail"         TEXT NOT NULL,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "lastUsedAt"      TIMESTAMP(3),
  "lastTestedAt"    TIMESTAMP(3),
  "lastTestOk"      BOOLEAN,
  "lastTestError"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "api_keys_org_provider_label_key"
  ON "core"."api_keys" ("organizationId", "provider", "label");
CREATE INDEX "api_keys_org_provider_active_idx"
  ON "core"."api_keys" ("organizationId", "provider", "isActive");
