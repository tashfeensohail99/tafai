-- Sales demo: prospect sign-in links + usage audit (core schema).
CREATE TABLE "core"."demo_access_links" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenTail" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_access_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "core"."demo_access_link_uses" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "demo_access_link_uses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demo_access_links_tokenHash_key" ON "core"."demo_access_links"("tokenHash");
CREATE INDEX "demo_access_links_expiresAt_idx" ON "core"."demo_access_links"("expiresAt");
CREATE INDEX "demo_access_link_uses_linkId_usedAt_idx" ON "core"."demo_access_link_uses"("linkId", "usedAt");

ALTER TABLE "core"."demo_access_link_uses" ADD CONSTRAINT "demo_access_link_uses_linkId_fkey"
  FOREIGN KEY ("linkId") REFERENCES "core"."demo_access_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
