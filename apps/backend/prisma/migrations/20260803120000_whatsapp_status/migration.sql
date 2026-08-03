-- WhatsApp Status posts. Employees prepare content in the CRM (image/video +
-- caption) and drive it through DRAFT → SCHEDULED → POSTED → EXPIRED. The
-- actual "post to My Status" step happens out-of-band on the employee's own
-- phone, because Meta doesn't expose a Status API.

CREATE TYPE "whatsapp"."WhatsAppStatusState" AS ENUM (
    'DRAFT',
    'SCHEDULED',
    'POSTED',
    'EXPIRED',
    'FAILED'
);

CREATE TYPE "whatsapp"."WhatsAppStatusMediaType" AS ENUM (
    'IMAGE',
    'VIDEO'
);

CREATE TABLE "whatsapp"."statuses" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "mediaType" "whatsapp"."WhatsAppStatusMediaType" NOT NULL,
    "mediaMimeType" TEXT NOT NULL,
    "mediaSizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "state" "whatsapp"."WhatsAppStatusState" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "statuses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "statuses_employeeId_state_idx" ON "whatsapp"."statuses" ("employeeId", "state");
CREATE INDEX "statuses_state_scheduledAt_idx" ON "whatsapp"."statuses" ("state", "scheduledAt");
CREATE INDEX "statuses_state_expiresAt_idx" ON "whatsapp"."statuses" ("state", "expiresAt");
