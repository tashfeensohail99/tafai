CREATE TABLE "ai"."brochures" (
  "id"            TEXT PRIMARY KEY,
  "programKey"    TEXT NOT NULL UNIQUE,
  "displayTitle"  TEXT NOT NULL,
  "s3Key"         TEXT NOT NULL,
  "mimeType"      TEXT NOT NULL DEFAULT 'application/pdf',
  "sizeBytes"     INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "brochures_programKey_idx" ON "ai"."brochures" ("programKey");
