import {
  HolidayType,
  LeaveKind,
  LeaveStatus,
  OfficialDutyStatus,
  OvertimeResolution,
  SalaryBasis,
  SaturdayPolicy,
} from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

export class UpdatePolicyDto {
  @IsOptional() @Matches(HHMM) workStart?: string;
  @IsOptional() @Matches(HHMM) workEnd?: string;
  @IsOptional() @Matches(HHMM) breakStart?: string;
  @IsOptional() @Matches(HHMM) breakEnd?: string;
  @IsOptional() @IsInt() @Min(0) allowedBreakMin?: number;
  @IsOptional() @IsInt() @Min(0) graceMin?: number;
  @IsOptional() @IsInt() @Min(0) fullDayMinMin?: number;
  @IsOptional() @IsInt() @Min(0) halfDayMinMin?: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) workingDays?: number[];
  @IsOptional() @IsEnum(SaturdayPolicy) saturdayPolicy?: SaturdayPolicy;
  @IsOptional() @IsBoolean() overtimeRequiresApproval?: boolean;
  @IsOptional() @Matches(HHMM) overtimeStartAfter?: string;
  @IsOptional() @IsInt() @Min(0) overtimeMinBlockMin?: number;
  @IsOptional() @IsEnum(SalaryBasis) salaryBasis?: SalaryBasis;
  @IsOptional() @IsInt() @Min(0) roundingMin?: number;
  @IsOptional() @IsInt() @Min(0) annualLeaveQuota?: number;
  @IsOptional() @IsInt() @Min(0) sickLeaveQuota?: number;
  @IsOptional() @IsInt() @Min(0) casualLeaveQuota?: number;
}

export class UpsertHolidayDto {
  @Matches(YMD) date!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsEnum(HolidayType) type?: HolidayType;
}

export class SetCompensationDto {
  @IsString() employeeId!: string;
  @IsNumber() @Min(0) basicSalary!: number;
  @IsOptional() @IsNumber() @Min(0) allowances?: number;
  @Matches(YMD) effectiveFrom!: string;
  @IsOptional() @IsString() @MaxLength(300) remarks?: string;
}

export class RecomputeDto {
  @IsOptional() @Matches(YMD) date?: string;
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
}

export class ApproveDayDto {
  @IsString() employeeId!: string;
  @Matches(YMD) date!: string;
}

export class ReviewExceptionDto {
  @IsEnum(['APPROVED', 'REJECTED'] as unknown as object) status!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsEnum(OvertimeResolution) overtimeResolution?: OvertimeResolution;
  @IsOptional() @IsString() @MaxLength(300) remark?: string;
}

export class AdjustDayDto {
  @IsString() employeeId!: string;
  @Matches(YMD) date!: string;
  @IsOptional() @IsInt() @Min(0) officialDutyMin?: number;
  @IsOptional() @IsInt() @Min(0) approvedExtraBreakMin?: number;
  @IsOptional() @IsString() status?: string; // AttendanceStatus
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsString() @MaxLength(300) reason!: string;
}

export class CreateOfficialDutyDto {
  @IsString() employeeId!: string;
  @Matches(YMD) date!: string;
  @Matches(HHMM) fromTime!: string;
  @Matches(HHMM) toTime!: string;
  @IsString() @MaxLength(300) reason!: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() attachmentKey?: string;
}

export class ReviewDutyDto {
  @IsEnum(OfficialDutyStatus) status!: OfficialDutyStatus;
  @IsOptional() @IsString() @MaxLength(300) remarks?: string;
}

export class CreateLeaveDto {
  @IsString() employeeId!: string;
  @IsEnum(LeaveKind) kind!: LeaveKind;
  @Matches(YMD) fromDate!: string;
  @Matches(YMD) toDate!: string;
  @IsOptional() @IsInt() @Min(1) days?: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class ReviewLeaveDto {
  @IsEnum(LeaveStatus) status!: LeaveStatus;
  @IsOptional() @IsString() @MaxLength(300) remarks?: string;
}

export class GeneratePayrollDto {
  @IsInt() @Min(2020) year!: number;
  @IsInt() @Min(1) month!: number;
}
