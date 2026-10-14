-- Service-health sentinel state: one row per monitored service. Additive.
CREATE TABLE "core"."system_alerts" (
  "id"         TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "active"     BOOLEAN NOT NULL DEFAULT false,
  "severity"   TEXT NOT NULL DEFAULT 'critical',
  "title"      TEXT NOT NULL,
  "message"    TEXT NOT NULL,
  "detail"     TEXT,
  "startedAt"  TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "system_alerts_key_key" ON "core"."system_alerts"("key");
