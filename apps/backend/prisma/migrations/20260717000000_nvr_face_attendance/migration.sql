-- NVR-based online face attendance (ported from intag). Purely additive: creates
-- the face-recognition tables in the `core` schema and their enums. The pgvector
-- extension is not managed by Prisma here, so ensure it exists first. Everything
-- is idempotent (IF NOT EXISTS) so a re-run after a partial apply is safe.

CREATE EXTENSION IF NOT EXISTS vector;

-- Enums (CREATE TYPE has no IF NOT EXISTS)
DO $$ BEGIN
  CREATE TYPE "core"."PunchDirection" AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "core"."FaceCaptureStatus" AS ENUM ('PENDING','MATCHED','UNMATCHED','DUPLICATE','ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Face enrollments (512-d ArcFace embeddings from the Python face-worker)
CREATE TABLE IF NOT EXISTS "core"."face_enrollments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "embedding" vector(512) NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'insightface-buffalo_l-512',
    "quality" DOUBLE PRECISION,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "face_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "face_enrollments_employeeId_idx" ON "core"."face_enrollments"("employeeId");

-- Raw in/out punch events (server-timestamped), rolled up into attendance_records
CREATE TABLE IF NOT EXISTS "core"."attendance_punches" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "core"."PunchDirection" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'KIOSK',
    "kioskId" TEXT,
    "branchId" TEXT,
    "similarity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "attendance_punches_employeeId_punchedAt_idx" ON "core"."attendance_punches"("employeeId","punchedAt");
CREATE INDEX IF NOT EXISTS "attendance_punches_punchedAt_idx" ON "core"."attendance_punches"("punchedAt");

-- Raw NVR face-capture events: dedup (eventUuid) + burst-vote aggregation + audit
CREATE TABLE IF NOT EXISTS "core"."face_capture_events" (
    "id" TEXT NOT NULL,
    "eventUuid" TEXT,
    "channelId" TEXT,
    "deviceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'NVR',
    "branchId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageObjectKey" TEXT,
    "status" "core"."FaceCaptureStatus" NOT NULL DEFAULT 'PENDING',
    "matchedEmployeeId" TEXT,
    "similarity" DOUBLE PRECISION,
    "detScore" DOUBLE PRECISION,
    "punchId" TEXT,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "face_capture_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "face_capture_events_eventUuid_key" ON "core"."face_capture_events"("eventUuid");
CREATE INDEX IF NOT EXISTS "face_capture_events_matchedEmployeeId_capturedAt_idx" ON "core"."face_capture_events"("matchedEmployeeId","capturedAt");
CREATE INDEX IF NOT EXISTS "face_capture_events_status_idx" ON "core"."face_capture_events"("status");
CREATE INDEX IF NOT EXISTS "face_capture_events_capturedAt_idx" ON "core"."face_capture_events"("capturedAt");
