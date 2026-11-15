import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { entities } from './entities';
import { EdenSecurity1794096000000 } from './migrations/1794096000000-eden-security';

import { ShoppingOperations1794096001000 } from './migrations/1794096001000-shopping-operations';
import { EdenDataApiLockdown1794096002000 } from './migrations/1794096002000-eden-data-api-lockdown';

// Environment must be supplied explicitly by the operator; never load checkout .env files.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities,
  migrations: [EdenSecurity1794096000000, ShoppingOperations1794096001000, EdenDataApiLockdown1794096002000],
  synchronize: false,
  migrationsRun: false,
  logging: false,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true },
});
