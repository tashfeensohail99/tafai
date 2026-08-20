import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEmail,
  IsUUID,
  IsArray,
  MaxLength,
  IsDateString,
  IsIn,
} from 'class-validator';

/**
 * One-shot onboarding: creates the login account, the employee profile, and
 * (optionally) a business mailbox on MXRoute — in a single call.
 */
export class OnboardEmployeeDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  firstName!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  lastName!: string;

  // If true, generate firstname@domain on MXRoute and use it as the login email.
  // If false, `email` must be supplied.
  @IsBoolean()
  generateBusinessEmail!: boolean;

  @IsOptional() @IsEmail()
  email?: string;

  // Optional personal number stored on the account.
  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  // Roles to grant (e.g. ["sales"]). Matched by name against active roles.
  @IsOptional() @IsArray() @IsString({ each: true })
  roleNames?: string[];

  @IsOptional() @IsUUID()
  departmentId?: string;

  @IsOptional() @IsUUID()
  branchId?: string;

  @IsOptional() @IsUUID()
  designationId?: string;

  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: 'MALE' | 'FEMALE' | 'OTHER';

  @IsOptional() @IsDateString()
  dateOfBirth?: string;

  @IsOptional() @IsString() @MaxLength(50)
  nationalId?: string;

  @IsOptional() @IsString() @MaxLength(50)
  passportNumber?: string;

  @IsOptional() @IsString() @MaxLength(60)
  nationality?: string;

  @IsOptional() @IsDateString()
  joiningDate?: string;

  // Add straight into the WhatsApp round-robin inbox pool.
  @IsOptional() @IsBoolean()
  whatsappInboxMember?: boolean;

  // Telenor Smart Office PBX extension.
  @IsOptional() @IsString() @MaxLength(10)
  pbxExtension?: string;
}

export class OffboardEmployeeDto {
  @IsUUID()
  employeeId!: string;

  // Also delete the MXRoute mailbox (permanent). Default: keep the mailbox,
  // only disable the CRM login.
  @IsOptional() @IsBoolean()
  deleteMailbox?: boolean;
}
