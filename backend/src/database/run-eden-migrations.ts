import 'reflect-metadata';
import { DataSource, MigrationExecutor, QueryRunner } from 'typeorm';
import { redactConnectionSecrets } from './connection-security';
import {
  BOOKKEEPING_TABLE, LOCK_TIMEOUT, assertPublicSchema, findDataApiLeaks, lockDownRelations, presentTables,
} from './migrations/1794095990000-existing-tables-data-api-lockdown';

// Runs only the Eden integration migrations (data-source-eden.ts) without the postponed
// existing-tables lockdown, while guaranteeing that the integration tables and TypeORM's
// bookkeeping table (and its sequence) are never committed reachable by the Data API roles:
//  1. read-only preflight: role, schema, recorded/pending migrations, exposure, duplicate
//     hidden products, long transactions;
//  2. if public.migrations already exists, lock it down in its own committed transaction;
//  3. in ONE transaction: create the bookkeeping table if absent (on our query runner), run the
//     pending Eden migrations, lock the bookkeeping table and sequence, verify no Data API access
//     to any Eden-protected relation, commit. Any failure rolls back everything.
// Pre-existing application tables other than hidden_products are not touched.
// `--check` performs step 1 only and changes nothing.

type Log = (line: string) => void;

export const EDEN_PROTECTED_TABLES = ['integration_credentials', 'shopping_operations', 'hidden_products', BOOKKEEPING_TABLE];

export interface EdenMigrationReport {
  user: string;
  schema: string;
  bookkeepingExists: boolean;
  recorded: string[];
  pending: string[];
  leaks: string[];
  duplicateHiddenProducts: number;
  longTransactions: number;
}

const migrationName = (m: any): string => m.name || m.constructor.name;

export async function inspectEdenMigrations(ds: DataSource, log: Log = () => undefined): Promise<EdenMigrationReport> {
  const q = ds.createQueryRunner();
  try {
    const [who] = await q.query(
      `SELECT current_user AS "user", current_schema() AS schema, r.rolsuper AS super, r.rolbypassrls AS "bypassRls"
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const present = await presentTables(q, ['hidden_products', BOOKKEEPING_TABLE]);
    const bookkeepingExists = present.includes(BOOKKEEPING_TABLE);
    const recorded: string[] = bookkeepingExists
      ? (await q.query(`SELECT name FROM "public"."${BOOKKEEPING_TABLE}" ORDER BY id`)).map((r: { name: string }) => r.name)
      : [];
    const pending = ds.migrations.map(migrationName).filter((n) => !recorded.includes(n));
    const leaks = await findDataApiLeaks(q, await presentTables(q, EDEN_PROTECTED_TABLES));
    const [{ n: duplicateHiddenProducts }] = present.includes('hidden_products')
      ? await q.query(`SELECT count(*)::int AS n FROM (SELECT 1 FROM "public"."hidden_products" GROUP BY "userId", "productId" HAVING count(*) > 1) d`)
      : [{ n: 0 }];
    const [{ n: longTransactions }] = await q.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND datname = current_database() AND xact_start < now() - interval '5 seconds'`,
    );
    const report: EdenMigrationReport = { user: who.user, schema: who.schema, bookkeepingExists, recorded, pending, leaks, duplicateHiddenProducts, longTransactions };

    const tls = ds.options.type === 'postgres' && ds.options.ssl ? 'required, server certificate and host name verified' : 'disabled (loopback test database only)';
    log(`Connected as ${who.user} (superuser=${who.super}, bypassrls=${who.bypassRls}); current schema ${who.schema}; TLS ${tls}`);
    log(`Bookkeeping table public.${BOOKKEEPING_TABLE}: ${bookkeepingExists ? `exists, recorded: ${recorded.join(', ') || 'none'}` : 'absent (will be created inside the migration transaction)'}`);
    log(`Pending Eden migrations: ${pending.join(', ') || 'none'}`);
    log(`Data API exposure of Eden-protected relations: ${leaks.length ? leaks.join(', ') : 'none'}`);
    log(`Duplicate hidden_products (userId, productId) groups: ${duplicateHiddenProducts}`);
    log(`Other transactions open longer than 5s: ${longTransactions}`);
    return report;
  } finally {
    await q.release();
  }
}

async function inTransaction(ds: DataSource, work: (q: QueryRunner) => Promise<void>): Promise<void> {
  const q = ds.createQueryRunner();
  await q.connect();
  try {
    await q.startTransaction();
    await work(q);
    await q.commitTransaction();
  } catch (error) {
    if (q.isTransactionActive) await q.rollbackTransaction().catch(() => undefined);
    throw error;
  } finally {
    await q.release();
  }
}

export async function runEdenMigrations(ds: DataSource, options: { check?: boolean; log?: Log } = {}): Promise<EdenMigrationReport> {
  const log = options.log ?? (() => undefined);
  const before = await inspectEdenMigrations(ds, log);
  if (before.schema !== 'public') throw new Error(`Refusing to run: current schema is ${JSON.stringify(before.schema)}, expected "public" (check search_path)`);
  if (before.duplicateHiddenProducts) throw new Error('Refusing to run: duplicate hidden_products rows would block the unique index; review them first');
  if (options.check) {
    log('Check only: no changes were made.');
    return before;
  }

  if (before.bookkeepingExists) {
    await inTransaction(ds, async (q) => {
      await q.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      await assertPublicSchema(q);
      await lockDownRelations(q, [BOOKKEEPING_TABLE]);
    });
    log('Bookkeeping table protected (committed separately; history kept).');
  }

  let executed: string[] = [];
  await inTransaction(ds, async (q) => {
    await q.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await assertPublicSchema(q);
    // The executor reuses our open transaction (creating the bookkeeping table on it if absent).
    executed = (await new MigrationExecutor(ds, q).executePendingMigrations()).map(migrationName);
    await lockDownRelations(q, [BOOKKEEPING_TABLE]);
    const leaks = await findDataApiLeaks(q, await presentTables(q, EDEN_PROTECTED_TABLES));
    if (leaks.length) throw new Error(`Data API roles would still have access: ${leaks.join(', ')}`);
  });
  log(executed.length ? `Executed: ${executed.join(', ')}` : 'No migrations were pending.');

  const after = await inspectEdenMigrations(ds, log);
  if (after.leaks.length || after.pending.length) throw new Error('Post-commit verification failed; see the report above');
  log('Verified: Eden tables, hidden_products and the bookkeeping table have RLS on and no anon/authenticated access.');
  return after;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  (async () => {
    let ds: DataSource | undefined;
    try {
      ds = (await import('./data-source-eden')).EdenDataSource;
      await ds.initialize();
      await runEdenMigrations(ds, { check, log: (line) => console.log(line) });
    } catch (error: any) {
      const code = error?.code ? ` [${error.code}]` : '';
      console.error(`Eden migration ${check ? 'check' : 'run'} failed${code}: ${redactConnectionSecrets(String(error?.message ?? error))}`);
      process.exitCode = 1;
    } finally {
      if (ds?.isInitialized) await ds.destroy();
    }
  })();
}
