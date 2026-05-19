import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ServiceContractStatus } from '@prisma/client';

export class CreateInstallmentInput {
  @IsInt()
  @Min(1)
  sequence!: number;

  @IsDateString()
  dueDate!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreateServiceContractDto {
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsNumber()
  @Min(0.01)
  totalAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsDateString()
  signedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInstallmentInput)
  installments!: CreateInstallmentInput[];
}

export class UpdateServiceContractDto {
  @IsOptional()
  @IsEnum(ServiceContractStatus)
  status?: ServiceContractStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  signedDate?: string;
}

export class ListServiceContractsQueryDto {
  @IsOptional()
  @IsEnum(ServiceContractStatus)
  status?: ServiceContractStatus;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
