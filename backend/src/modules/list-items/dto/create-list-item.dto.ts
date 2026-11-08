import {
  IsUUID,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateListItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @IsOptional()
  @Max(99999999.99)
  @Min(0)
  quantity?: number;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(32)
  unit?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isPurchased?: boolean;
}
