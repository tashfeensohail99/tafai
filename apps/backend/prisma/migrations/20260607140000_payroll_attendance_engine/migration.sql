-- Payroll + Attendance Rules Engine
-- Raw -> Computed -> Approved -> Payroll (locked snapshot)

-- ── Extend existing enums (PG15 allows ADD VALUE in a tx; values not used here) ──
ALTER TYPE "core"."AttendanceStatus" ADD VALUE IF NOT EXISTS 'HOLIDAY';
ALTER TYPE "core"."AttendanceStatus" ADD VALUE IF NOT EXISTS 'WEEKLY_OFF';
ALTER TYPE "core"."AttendanceStatus" ADD VALUE IF NOT EXISTS 'OFFICIAL_DUTY';

ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_POLICY_UPDATED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'HOLIDAY_UPSERTED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'COMPENSATION_UPDATED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_APPROVED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_ADJUSTED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_EXCEPTION_REVIEWED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'OFFICIAL_DUTY_REVIEWED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'LEAVE_REVIEWED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'OVERTIME_REVIEWED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'PAYROLL_GENERATED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'PAYROLL_PERIOD_LOCKED';
ALTER TYPE "audit"."AuditAction" ADD VALUE IF NOT EXISTS 'PAYROLL_PERIOD_UNLOCKED';

-- ── New enums (core) ──
CREATE TYPE "core"."AttendanceDayType" AS ENUM ('WORKING', 'SATURDAY', 'WEEKLY_OFF', 'HOLIDAY');
CREATE TYPE "core"."AttendanceReviewStatus" AS ENUM ('COMPUTED', 'NEEDS_REVIEW', 'APPROVED', 'LOCKED');
CREATE TYPE "core"."AttendanceExceptionType" AS ENUM ('LATE', 'EARLY_LEAVE', 'SHORT_HOURS', 'EXTRA_BREAK', 'UNSCHEDULED_EXIT', 'OVERTIME', 'MISSING_PUNCH', 'ABSENT');
CREATE TYPE "core"."ExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "core"."OvertimeResolution" AS ENUM ('PENDING', 'APPROVED_PAID', 'COMPENSATORY', 'REJECTED', 'IGNORED');
CREATE TYPE "core"."OfficialDutyStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "core"."LeaveKind" AS ENUM ('ANNUAL', 'SICK', 'CASUAL', 'UNPAID');
CREATE TYPE "core"."LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "core"."HolidayType" AS ENUM ('NATIONAL', 'RELIGIOUS', 'COMPANY', 'EMERGENCY');
CREATE TYPE "core"."PayrollPeriodStatus" AS ENUM ('DRAFT', 'LOCKED');
CREATE TYPE "core"."SaturdayPolicy" AS ENUM ('OPTIONAL_WFH', 'OFF', 'WORKING');
CREATE TYPE "core"."SalaryBasis" AS ENUM ('THIRTY_DAYS', 'WORKING_DAYS');

-- ── Extend attendance_records (computed + approved layers) ──
ALTER TABLE "core"."attendance_records"
  ADD COLUMN "dayType" "core"."AttendanceDayType" NOT NULL DEFAULT 'WORKING',
  ADD COLUMN "grossPresenceMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "breakMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "personalMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "personalOverMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unscheduledExits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "earlyLeaveMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "officialDutyMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approvedExtraBreakMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "netPayableMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewStatus" "core"."AttendanceReviewStatus" NOT NULL DEFAULT 'COMPUTED',
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'CAMERA',
  ADD COLUMN "lockedPayrollPeriodId" TEXT;

CREATE INDEX "attendance_records_reviewStatus_idx" ON "core"."attendance_records"("reviewStatus");
CREATE INDEX "attendance_records_lockedPayrollPeriodId_idx" ON "core"."attendance_records"("lockedPayrollPeriodId");

-- ── attendance_policies ──
CREATE TABLE "core"."attendance_policies" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "workStart" TEXT NOT NULL DEFAULT '09:00',
  "workEnd" TEXT NOT NULL DEFAULT '18:00',
  "breakStart" TEXT NOT NULL DEFAULT '12:30',
  "breakEnd" TEXT NOT NULL DEFAULT '14:00',
  "allowedBreakMin" INTEGER NOT NULL DEFAULT 90,
  "graceMin" INTEGER NOT NULL DEFAULT 15,
  "fullDayMinMin" INTEGER NOT NULL DEFAULT 480,
  "halfDayMinMin" INTEGER NOT NULL DEFAULT 240,
  "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
  "saturdayPolicy" "core"."SaturdayPolicy" NOT NULL DEFAULT 'OPTIONAL_WFH',
  "overtimeRequiresApproval" BOOLEAN NOT NULL DEFAULT true,
  "overtimeStartAfter" TEXT NOT NULL DEFAULT '18:00',
  "overtimeMinBlockMin" INTEGER NOT NULL DEFAULT 30,
  "salaryBasis" "core"."SalaryBasis" NOT NULL DEFAULT 'THIRTY_DAYS',
  "roundingMin" INTEGER NOT NULL DEFAULT 0,
  "annualLeaveQuota" INTEGER NOT NULL DEFAULT 14,
  "sickLeaveQuota" INTEGER NOT NULL DEFAULT 8,
  "casualLeaveQuota" INTEGER NOT NULL DEFAULT 10,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_policies_orgId_isActive_idx" ON "core"."attendance_policies"("orgId", "isActive");

-- ── holidays ──
CREATE TABLE "core"."holidays" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "type" "core"."HolidayType" NOT NULL DEFAULT 'COMPANY',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "holidays_orgId_date_key" ON "core"."holidays"("orgId", "date");
CREATE INDEX "holidays_orgId_idx" ON "core"."holidays"("orgId");

-- ── employee_compensations ──
CREATE TABLE "core"."employee_compensations" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "basicSalary" DECIMAL(12,2) NOT NULL,
  "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "effectiveFrom" DATE NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "remarks" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_compensations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_compensations_employeeId_effectiveFrom_idx" ON "core"."employee_compensations"("employeeId", "effectiveFrom");

-- ── attendance_exceptions ──
CREATE TABLE "core"."attendance_exceptions" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "type" "core"."AttendanceExceptionType" NOT NULL,
  "status" "core"."ExceptionStatus" NOT NULL DEFAULT 'PENDING',
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "overtimeResolution" "core"."OvertimeResolution",
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_exceptions_employeeId_date_type_key" ON "core"."attendance_exceptions"("employeeId", "date", "type");
CREATE INDEX "attendance_exceptions_status_idx" ON "core"."attendance_exceptions"("status");
CREATE INDEX "attendance_exceptions_employeeId_date_idx" ON "core"."attendance_exceptions"("employeeId", "date");

-- ── official_duty_slips ──
CREATE TABLE "core"."official_duty_slips" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "fromTime" TEXT NOT NULL,
  "toTime" TEXT NOT NULL,
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "location" TEXT,
  "status" "core"."OfficialDutyStatus" NOT NULL DEFAULT 'PENDING',
  "attachmentKey" TEXT,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "official_duty_slips_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "official_duty_slips_employeeId_date_idx" ON "core"."official_duty_slips"("employeeId", "date");
CREATE INDEX "official_duty_slips_status_idx" ON "core"."official_duty_slips"("status");

-- ── attendance_adjustments ──
CREATE TABLE "core"."attendance_adjustments" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "action" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "reason" TEXT,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_adjustments_employeeId_date_idx" ON "core"."attendance_adjustments"("employeeId", "date");

-- ── leave_requests ──
CREATE TABLE "core"."leave_requests" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "kind" "core"."LeaveKind" NOT NULL,
  "fromDate" DATE NOT NULL,
  "toDate" DATE NOT NULL,
  "days" INTEGER NOT NULL DEFAULT 1,
  "paid" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "status" "core"."LeaveStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "remarks" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leave_requests_employeeId_status_idx" ON "core"."leave_requests"("employeeId", "status");
CREATE INDEX "leave_requests_fromDate_toDate_idx" ON "core"."leave_requests"("fromDate", "toDate");

-- ── payroll_periods ──
CREATE TABLE "core"."payroll_periods" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "core"."PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
  "generatedAt" TIMESTAMP(3),
  "lockedByUserId" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_periods_orgId_year_month_key" ON "core"."payroll_periods"("orgId", "year", "month");

-- ── payslips ──
CREATE TABLE "core"."payslips" (
  "id" TEXT NOT NULL,
  "payrollPeriodId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "basicSalary" DECIMAL(12,2) NOT NULL,
  "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "dailyRate" DECIMAL(12,2) NOT NULL,
  "workingDays" INTEGER NOT NULL DEFAULT 0,
  "presentDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
  "absentDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
  "halfDays" INTEGER NOT NULL DEFAULT 0,
  "paidLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
  "unpaidLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
  "holidays" INTEGER NOT NULL DEFAULT 0,
  "lateDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "absenceDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "unpaidLeaveDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "otherDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "overtimePay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "additions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "netPayable" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "policySnapshot" JSONB,
  "breakdown" JSONB,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payslips_payrollPeriodId_employeeId_key" ON "core"."payslips"("payrollPeriodId", "employeeId");
CREATE INDEX "payslips_employeeId_idx" ON "core"."payslips"("employeeId");
