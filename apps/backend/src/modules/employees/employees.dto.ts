import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Gender } from '@prisma/client';

export class CreateEmployeeDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nationalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  passportNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @IsOptional()
  @IsDateString()
  joiningDate?: string;

  /** Only used for the welcome-email body — never stored in the database. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tempPasswordForEmail?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  // --- WhatsApp inbox membership ------------------------------------------
  // When true, this employee enters the round-robin pool used by the WhatsApp
  // assignment engine. Toggle from the Employee admin form.
  @IsOptional()
  @IsBoolean()
  whatsappInboxMember?: boolean;

  // Soft routing preference. Examples: ["UK","Canada","StudentVisa"].
  // The routing engine prefers (but doesn't strictly require) a skill match.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  skills?: string[];

  // --- Telenor Smart Office PBX extension ---------------------------------
  // 2–6 digit extension Telenor assigns this rep (after account activation).
  // The call-routing Customer API returns it so Smart Office rings this rep.
  // Send `null` to clear it; omit to leave unchanged.
  // Three states: omitted (no change), null (clear), or 2–6 digits (set).
  // @ValidateIf skips the regex on an explicit null so the field can be cleared.
  @IsOptional()
  @ValidateIf((o) => o.pbxExtension !== null)
  @Matches(/^\d{2,6}$/, { message: 'PBX extension must be 2–6 digits' })
  pbxExtension?: string | null;
}
