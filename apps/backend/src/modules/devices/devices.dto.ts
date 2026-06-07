import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DevicePlatform } from '@prisma/client';

export class RegisterDeviceDto {
  /** The FCM registration token from the mobile/web client. */
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token!: string;

  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  /** Optional client hint (device model / app version) for admin debugging. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceInfo?: string;
}
