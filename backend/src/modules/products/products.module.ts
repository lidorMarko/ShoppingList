import { UploadsModule } from '../uploads/uploads.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Product } from '../../database/entities/product.entity';
import { SessionItem } from '../../database/entities/session-item.entity';
import { Profile } from '../../database/entities/profile.entity';
import { HiddenProduct } from '../../database/entities/hidden-product.entity';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [UploadsModule, ConfigModule, TypeOrmModule.forFeature([Product, SessionItem, Profile, HiddenProduct])],
  controllers: [ProductsController],
  providers: [ProductsService, ConfigService],
  exports: [ProductsService],
})
export class ProductsModule {}
