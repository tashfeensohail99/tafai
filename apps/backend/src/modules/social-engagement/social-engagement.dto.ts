import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SocialEngagementStatus, SocialPlatform } from '@prisma/client';

export class UpdateHandleDto {
  // `null`/'' clears the field; a value is normalised server-side.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  instagramHandle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  facebookProfileUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  facebookDisplayName?: string | null;
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
