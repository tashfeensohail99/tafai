import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Camera → CRM: an operator enrolled a walk-in/new hire. This files a PENDING
 * request only — it never creates an employee. An admin approves it later.
 * Requires a name (fullName or firstName) and at least one contact (phone/email);
 * the service enforces that.
 */
export class SubmitEnrollmentDto {
  @IsOptional() @IsString() @MaxLength(160)
  fullName?: string;

  @IsOptional() @IsString() @MaxLength(80)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(80)
  lastName?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(120)
  department?: string;

  @IsOptional() @IsString() @MaxLength(40)
  cnic?: string;

  @IsOptional() @IsString() @MaxLength(20)
  joiningDate?: string; // YYYY-MM-DD

  @IsOptional() @IsString() @MaxLength(120)
  cameraEmpCode?: string; // the camera's temporary id (echoed back for reconciliation)

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

/** Admin approves a pending request → creates a real User + Employee. */
export class ApproveEnrollmentDto {
  // A UserAccount needs a unique email — the admin supplies/confirms it.
  @IsEmail()
  email!: string;

  // Role to assign to the new account (e.g. "sales", "staff").
  @IsString() @MinLength(1)
  roleName!: string;

  // Optional corrections to the captured name.
  @IsOptional() @IsString() @MaxLength(80)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(80)
  lastName?: string;

  // Optional department to attach on the employee profile.
  @IsOptional() @IsString()
  departmentId?: string;
}

export class RejectEnrollmentDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

/** Admin master on/off switch for camera-initiated enrollment. */
export class UpdateEnrollmentSettingsDto {
  @IsBoolean()
  enabled!: boolean;
}
