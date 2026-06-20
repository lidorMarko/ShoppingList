import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListItem } from '../../database/entities/list-item.entity';
import { ListItemsService } from './list-items.service';
import { ListItemsController } from './list-items.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ListItem])],
  controllers: [ListItemsController],
  providers: [ListItemsService],
  exports: [ListItemsService],
})
export class ListItemsModule {}
