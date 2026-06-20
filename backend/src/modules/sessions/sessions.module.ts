import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShoppingSession } from '../../database/entities/shopping-session.entity';
import { SessionItem } from '../../database/entities/session-item.entity';
import { ShoppingList } from '../../database/entities/shopping-list.entity';
import { ListItem } from '../../database/entities/list-item.entity';
import { Profile } from '../../database/entities/profile.entity';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingSession, SessionItem, ShoppingList, ListItem, Profile])],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
