import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class UpdateSessionItemDto {
  @IsBoolean()
  @IsOptional()
  isPurchased?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  quantity?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AddSessionItemDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  quantity?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
