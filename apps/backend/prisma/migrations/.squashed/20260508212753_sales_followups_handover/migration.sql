-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FinanceHandoverStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FOLLOW_UP_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FOLLOW_UP_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FOLLOW_UP_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'FINANCE_HANDOVER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FINANCE_HANDOVER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FINANCE_HANDOVER_REVIEWED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TimelineEventType" ADD VALUE 'FOLLOW_UP_CREATED';
ALTER TYPE "TimelineEventType" ADD VALUE 'FOLLOW_UP_COMPLETED';
ALTER TYPE "TimelineEventType" ADD VALUE 'FINANCE_HANDOVER_SUBMITTED';
ALTER TYPE "TimelineEventType" ADD VALUE 'FINANCE_HANDOVER_REVIEWED';

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedEmployeeId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "completedByUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contactMethod" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "outcomeNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_handovers" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "status" "FinanceHandoverStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "paymentMethod" TEXT,
    "transactionRef" TEXT,
    "notes" TEXT,
    "financeNotes" TEXT,
    "receiptKey" TEXT NOT NULL,
    "receiptFileName" TEXT NOT NULL,
    "receiptMimeType" TEXT,
    "receiptSizeBytes" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_ups_leadId_idx" ON "follow_ups"("leadId");

-- CreateIndex
CREATE INDEX "follow_ups_assignedEmployeeId_idx" ON "follow_ups"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "follow_ups_status_idx" ON "follow_ups"("status");

-- CreateIndex
CREATE INDEX "follow_ups_dueAt_idx" ON "follow_ups"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "finance_handovers_paymentId_key" ON "finance_handovers"("paymentId");

-- CreateIndex
CREATE INDEX "finance_handovers_leadId_idx" ON "finance_handovers"("leadId");

-- CreateIndex
CREATE INDEX "finance_handovers_invoiceId_idx" ON "finance_handovers"("invoiceId");

-- CreateIndex
CREATE INDEX "finance_handovers_status_idx" ON "finance_handovers"("status");

-- CreateIndex
CREATE INDEX "finance_handovers_createdByUserId_idx" ON "finance_handovers"("createdByUserId");

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_handovers" ADD CONSTRAINT "finance_handovers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_handovers" ADD CONSTRAINT "finance_handovers_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_handovers" ADD CONSTRAINT "finance_handovers_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
