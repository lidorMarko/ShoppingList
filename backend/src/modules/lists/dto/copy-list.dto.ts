import { IsUUID, IsNotEmpty } from 'class-validator';

export class CopyListDto {
  @IsUUID()
  @IsNotEmpty()
  targetListId: string;
}
