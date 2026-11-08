import { entities } from './database/entities';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { ListsModule } from './modules/lists/lists.module';
import { ListItemsModule } from './modules/list-items/list-items.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { AuthModule } from './modules/auth/auth.module';
import { FamiliesModule } from './modules/families/families.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const dbUrl = new URL(config.get<string>('DATABASE_URL'));
        return {
          type: 'postgres' as const,
          host: dbUrl.hostname,
          port: parseInt(dbUrl.port) || 5432,
          username: decodeURIComponent(dbUrl.username),
          password: decodeURIComponent(dbUrl.password),
          database: dbUrl.pathname.slice(1),
          entities,
          synchronize: false,
          logging: false,
          ssl: config.get('DATABASE_SSL') === 'false' ? false : { rejectUnauthorized: true },
          extra: { family: 4 },
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    FamiliesModule,
    CategoriesModule,
    ProductsModule,
    ListsModule,
    ListItemsModule,
    UploadsModule,
    SessionsModule,
  ],
})
export class AppModule {}
