import { IsString, IsNotEmpty, IsOptional, IsUUID, IsUrl } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUrl()
  @IsOptional()
  imageUrl?: string;
}
