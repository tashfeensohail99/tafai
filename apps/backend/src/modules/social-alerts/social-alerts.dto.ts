import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SocialPlatform } from '@prisma/client';

export const ALERT_CHANNELS = ['EMAIL', 'BELL', 'BANNER'] as const;

export class UpdateSocialAlertConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Department NAMES to alert. Empty array = all active departments. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  departments?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(SocialPlatform, { each: true })
  @ArrayUnique()
  platforms?: SocialPlatform[];

  @IsOptional()
  @IsArray()
  @IsIn(ALERT_CHANNELS as unknown as string[], { each: true })
  @ArrayUnique()
  channels?: string[];

  // `null` clears the window; a 0–23 hour sets it. Both must be set to take effect.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  quietStartHour?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  quietEndHour?: number | null;
}
