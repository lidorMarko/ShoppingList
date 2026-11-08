import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
const text = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().normalize('NFC') : value;

export class BatchItemDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @Transform(text) @IsString() @IsNotEmpty() @MaxLength(200) productName?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false }) @Min(0) @Max(99999999.99) quantity?: number;
  @IsOptional() @Transform(text) @IsString() @IsNotEmpty() @MaxLength(32) unit?: string;
  @IsOptional() @Transform(text) @IsString() @MaxLength(2000) notes?: string;
  @ValidateIf((_, value) => value !== undefined) @IsBoolean() isPurchased?: boolean;
}
export class BatchItemsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => BatchItemDto) items: BatchItemDto[];
}
export class SetPurchasedDto { @IsBoolean() isPurchased: boolean; }
