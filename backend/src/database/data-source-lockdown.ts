import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { migrationConnectionOptions } from './connection-security';
import { ExistingTablesDataApiLockdown1794095990000 } from './migrations/1794095990000-existing-tables-data-api-lockdown';

// Applies only the existing-tables Data API lockdown, so it can ship ahead of the Eden
// integration migrations. A later full `migration:run` sees it recorded and skips it.
// Run it through src/database/run-data-api-lockdown.ts (npm run migration:run:data-api-lockdown),
// not the TypeORM CLI: the runner creates TypeORM's bookkeeping table inside the migration
// transaction. No entities are loaded, so connecting issues no extension DDL (the --check mode
// is read-only). Environment must be supplied explicitly by the operator; never load .env files.
const connection = migrationConnectionOptions();

export const LockdownDataSource = new DataSource({
  type: 'postgres',
  url: connection.url,
  ssl: connection.ssl,
  entities: [],
  migrations: [ExistingTablesDataApiLockdown1794095990000],
  migrationsTransactionMode: 'all',
  synchronize: false,
  migrationsRun: false,
  logging: false,
});
