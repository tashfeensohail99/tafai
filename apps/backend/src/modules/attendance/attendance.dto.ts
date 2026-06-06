import { AttendanceStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

/**
 * Pull attendance from the camera cloud and store it. Provide either a single
 * `date`, or a `from`/`to` range. Omit everything to sync today.
 */
export class SyncAttendanceDto {
  @IsOptional() @Matches(YMD, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional() @Matches(YMD, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional() @Matches(YMD, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/**
 * Manually set / correct one employee's attendance for one day. Flagged as an
 * override so the camera sync never clobbers it. Times are HH:MM (Asia/Karachi).
 */
export class MarkAttendanceDto {
  @IsString()
  employeeId!: string;

  @Matches(YMD, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional() @Matches(HHMM, { message: 'checkIn must be HH:MM' })
  checkIn?: string;

  @IsOptional() @Matches(HHMM, { message: 'checkOut must be HH:MM' })
  checkOut?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}
