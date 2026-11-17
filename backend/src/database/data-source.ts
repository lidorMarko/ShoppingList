import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { entities } from './entities';
import { migrationConnectionOptions } from './connection-security';
import { ExistingTablesDataApiLockdown1794095990000 } from './migrations/1794095990000-existing-tables-data-api-lockdown';
import { EdenSecurity1794096000000 } from './migrations/1794096000000-eden-security';

import { ShoppingOperations1794096001000 } from './migrations/1794096001000-shopping-operations';
import { EdenDataApiLockdown1794096002000 } from './migrations/1794096002000-eden-data-api-lockdown';

// Environment must be supplied explicitly by the operator; never load checkout .env files.
// TLS is verified; see connection-security.ts for the Supabase CA and refused URL parameters.
const connection = migrationConnectionOptions();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: connection.url,
  ssl: connection.ssl,
  entities,
  migrations: [ExistingTablesDataApiLockdown1794095990000, EdenSecurity1794096000000, ShoppingOperations1794096001000, EdenDataApiLockdown1794096002000],
  synchronize: false,
  migrationsRun: false,
  logging: false,
});
