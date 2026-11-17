import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { migrationConnectionOptions } from './connection-security';
import { EdenSecurity1794096000000 } from './migrations/1794096000000-eden-security';
import { ShoppingOperations1794096001000 } from './migrations/1794096001000-shopping-operations';
import { EdenDataApiLockdown1794096002000 } from './migrations/1794096002000-eden-data-api-lockdown';

// Applies only the three Eden integration migrations. It deliberately excludes the existing-tables
// Data API lockdown (1794095990000) so the integration can ship while that release is postponed;
// running the lockdown later is unaffected (it is recorded separately and still pending).
// Run it through src/database/run-eden-migrations.ts (npm run migration:run:eden), never the
// TypeORM CLI: the runner creates TypeORM's bookkeeping table inside the migration transaction
// and locks it down before commit. No entities are loaded, so --check issues no DDL.
// Environment must be supplied explicitly by the operator; never load .env files.
const connection = migrationConnectionOptions();

export const EdenDataSource = new DataSource({
  type: 'postgres',
  url: connection.url,
  ssl: connection.ssl,
  entities: [],
  migrations: [EdenSecurity1794096000000, ShoppingOperations1794096001000, EdenDataApiLockdown1794096002000],
  migrationsTransactionMode: 'all',
  synchronize: false,
  migrationsRun: false,
  logging: false,
});
