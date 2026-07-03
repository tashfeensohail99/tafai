-- CreateEnum
CREATE TYPE "crm"."VisitType" AS ENUM ('WALK_IN', 'EXISTING_CLIENT', 'PAID_CONSULT');

-- CreateEnum
CREATE TYPE "crm"."VisitStatus" AS ENUM ('WAITING', 'IN_MEETING', 'DONE', 'NO_SHOW', 'CANCELLED');

-- CreateTable
CREATE TABLE "crm"."visits" (
    "id" TEXT NOT NULL,
    "visitType" "crm"."VisitType" NOT NULL,
    "status" "crm"."VisitStatus" NOT NULL DEFAULT 'WAITING',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "leadId" TEXT,
    "clientId" TEXT,
    "hostEmployeeId" TEXT,
    "appointmentId" TEXT,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "purpose" TEXT,
    "notes" TEXT,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),
    "checkedInByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visits_status_checkedInAt_idx" ON "crm"."visits"("status", "checkedInAt" DESC);

-- CreateIndex
CREATE INDEX "visits_checkedInAt_idx" ON "crm"."visits"("checkedInAt" DESC);

-- CreateIndex
CREATE INDEX "visits_visitType_idx" ON "crm"."visits"("visitType");

-- CreateIndex
CREATE INDEX "visits_leadId_idx" ON "crm"."visits"("leadId");

-- CreateIndex
CREATE INDEX "visits_clientId_idx" ON "crm"."visits"("clientId");
