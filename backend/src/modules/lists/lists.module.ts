import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShoppingList } from '../../database/entities/shopping-list.entity';
import { ListItem } from '../../database/entities/list-item.entity';
import { Profile } from '../../database/entities/profile.entity';
import { ListsService } from './lists.service';
import { ListsController } from './lists.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingList, ListItem, Profile])],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [ListsService],
})
export class ListsModule {}
