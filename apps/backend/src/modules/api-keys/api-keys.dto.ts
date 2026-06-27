import { IsBoolean, IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const SUPPORTED_PROVIDERS = ['openai', 'fcm', 'meta_ads'] as const;

export class UpsertApiKeyDto {
  @IsString()
  @IsIn(SUPPORTED_PROVIDERS as unknown as string[])
  provider!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;

  /** Plaintext secret — accepted once, then encrypted at rest. */
  @IsString()
  @MinLength(8)
  @MaxLength(16384) // large enough for a full FCM service-account JSON (~2.5 KB), not just short API keys
  key!: string;
}

export class SetActiveApiKeyDto {
  @IsBoolean()
  isActive!: boolean;
}
