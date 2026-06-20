import { IsUUID, IsNotEmpty } from 'class-validator';

export class CreateSessionDto {
  @IsUUID()
  @IsNotEmpty()
  shoppingListId: string;
}
