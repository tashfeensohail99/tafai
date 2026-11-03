import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SocialEngagementStatus, SocialPlatform } from '@prisma/client';

/** Step 1 of the shared public form: search your name in the staff directory. */
export class IntakeSearchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;
}

/** Step 2: the opaque signed token returned for the picked name. */
export class IntakePickDto {
  @IsString()
  @MinLength(8)
  @MaxLength(400)
  pickToken!: string;
}

export class UpdateHandleDto {
  // `null`/'' clears the field; a value is normalised server-side.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  instagramHandle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  facebookProfileUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  facebookDisplayName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  linkedinUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tiktokHandle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  youtubeChannelUrl?: string | null;
}

/** Fields posted by the public self-submit form. Accepts a handle OR a URL;
 *  normalised + validated per platform server-side. Instagram is required. */
/** Logged-in employee submitting their own handles (identity from the JWT). */
export class SelfHandlesDto {
  @IsString()
  @MaxLength(300)
  instagram!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  facebookUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  linkedinUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tiktok?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  youtube?: string;
}

export class PublicIntakeDto {
  // The picked employee's opaque signed token (from the name search).
  @IsString()
  @MinLength(8)
  @MaxLength(400)
  pickToken!: string;

  @IsString()
  @MaxLength(300)
  instagram!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  facebookUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  linkedinUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tiktok?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  youtube?: string;
}

export class SubmitClaimDto {
  @IsUUID()
  employeeId!: string;

  // The FB post the comment was left on — selected from the swept-posts picker.
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  postExternalId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  postUrl?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  commentText!: string;
}

export class EngagementListQuery {
  @IsOptional()
  @IsString()
  days?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(SocialPlatform)
  platform?: SocialPlatform;

  @IsOptional()
  @IsEnum(SocialEngagementStatus)
  status?: SocialEngagementStatus;
}

export class PostListQuery {
  @IsOptional()
  @IsString()
  days?: string;

  @IsOptional()
  @IsEnum(SocialPlatform)
  platform?: SocialPlatform;
}

export class ScoreboardQuery {
  @IsOptional()
  @IsString()
  days?: string;
}
