import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ListActivityTimelineQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  caseId?: string;
}

export class GetEntityTimelineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  entityType!: string;

  @IsUUID()
  entityId!: string;
}