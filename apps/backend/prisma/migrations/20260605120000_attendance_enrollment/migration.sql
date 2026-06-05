-- CreateEnum
CREATE TYPE "core"."AttendanceEnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DUPLICATE');

-- AlterTable: master on/off switch for camera-initiated enrollment (default OFF)
ALTER TABLE "core"."organizations" ADD COLUMN "attendanceEnrollmentEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "core"."attendance_enrollment_requests" (
    "id" TEXT NOT NULL,
    "status" "core"."AttendanceEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "cnic" TEXT,
    "joiningDate" TIMESTAMP(3),
    "cameraEmpCode" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'camera',
    "employeeId" TEXT,
    "matchedEmployeeId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_enrollment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_enrollment_requests_status_idx" ON "core"."attendance_enrollment_requests"("status");

-- CreateIndex
CREATE INDEX "attendance_enrollment_requests_phone_idx" ON "core"."attendance_enrollment_requests"("phone");
