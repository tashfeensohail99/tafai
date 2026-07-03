-- CreateEnum
CREATE TYPE "crm"."VisitorPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "crm"."VisitorPaymentStatus" AS ENUM ('AWAITING_PROOF', 'PENDING_REVIEW', 'VERIFYING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "crm"."visitor_payments" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "method" "crm"."VisitorPaymentMethod" NOT NULL,
    "status" "crm"."VisitorPaymentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "transactionRef" TEXT,
    "proofImageKey" TEXT,
    "ocrAmount" DECIMAL(12,2),
    "ocrReference" TEXT,
    "ocrBankName" TEXT,
    "ocrPaidAt" TIMESTAMP(3),
    "ocrRawText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "ocrStatus" TEXT,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "receiptNumber" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitor_payments_status_createdAt_idx" ON "crm"."visitor_payments"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "visitor_payments_visitId_idx" ON "crm"."visitor_payments"("visitId");

-- CreateIndex
CREATE INDEX "visitor_payments_method_createdAt_idx" ON "crm"."visitor_payments"("method", "createdAt" DESC);
