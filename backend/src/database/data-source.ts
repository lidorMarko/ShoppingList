import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ShoppingList } from './entities/shopping-list.entity';
import { ListItem } from './entities/list-item.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Category, Product, ShoppingList, ListItem],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: true,
  ssl: { rejectUnauthorized: false },
});
