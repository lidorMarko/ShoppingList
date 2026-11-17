import 'reflect-metadata';
import { DataSource, MigrationExecutor, QueryRunner } from 'typeorm';
import { redactConnectionSecrets } from './connection-security';
import {
  BOOKKEEPING_TABLE, EXISTING_APP_TABLES, LOCK_TIMEOUT,
  assertPublicSchema, findDataApiLeaks, lockDownRelations, presentTables,
} from './migrations/1794095990000-existing-tables-data-api-lockdown';

// Runs the existing-tables Data API lockdown so that TypeORM's bookkeeping table can never be
// left reachable by the Data API roles, even when the migration fails:
//  1. read-only preflight: role, schema, ownership, exposure, recorded and pending migrations;
//  2. if public.migrations already exists, lock it down in its own committed transaction
//     (history rows are kept);
//  3. in ONE transaction: create the bookkeeping table if absent (TypeORM's own DDL, run on our
//     query runner), run the lockdown migration, record it, re-verify, commit. A failure rolls
//     back all of it, including the table creation.
// The TypeORM CLI would instead create the bookkeeping table before opening its transaction,
// leaving it exposed (RLS off, Supabase default grants) after a failed run.
// `--check` performs step 1 only and changes nothing.

type Log = (line: string) => void;

export interface LockdownReport {
  user: string;
  schema: string;
  version: number;
  bypassRls: boolean;
  tables: { name: string; owner: string; rls: boolean; owned: boolean }[];
  bookkeepingExists: boolean;
  recorded: string[];
  pending: string[];
  leaks: string[];
  longTransactions: number;
}

const migrationName = (m: any): string => m.name || m.constructor.name;

export async function inspectDataApiLockdown(ds: DataSource, log: Log = () => undefined): Promise<LockdownReport> {
  const q = ds.createQueryRunner();
  try {
    const [who] = await q.query(
      `SELECT current_user AS "user", current_schema() AS schema, current_setting('server_version_num')::int AS version,
              r.rolsuper AS super, r.rolbypassrls AS "bypassRls"
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const names = await presentTables(q, [...EXISTING_APP_TABLES, BOOKKEEPING_TABLE]);
    const tables = (await q.query(
      `SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls,
              pg_has_role(current_user, c.relowner, 'USAGE') AS owned
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[]) ORDER BY 1`,
      [names],
    )) as LockdownReport['tables'];
    const bookkeepingExists = names.includes(BOOKKEEPING_TABLE);
    const recorded: string[] = bookkeepingExists
      ? (await q.query(`SELECT name FROM "public"."${BOOKKEEPING_TABLE}" ORDER BY id`)).map((r: { name: string }) => r.name)
      : [];
    const pending = ds.migrations.map(migrationName).filter((n) => !recorded.includes(n));
    const leaks = await findDataApiLeaks(q, names);
    const [{ n: longTransactions }] = await q.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND datname = current_database() AND xact_start < now() - interval '5 seconds'`,
    );
    const report: LockdownReport = { user: who.user, schema: who.schema, version: who.version, bypassRls: who.bypassRls, tables, bookkeepingExists, recorded, pending, leaks, longTransactions };

    const tls = ds.options.type === 'postgres' && ds.options.ssl ? 'required, server certificate and host name verified' : 'disabled (loopback test database only)';
    log(`Connected as ${report.user} (superuser=${who.super}, bypassrls=${report.bypassRls}); current schema ${report.schema}; server ${report.version}; TLS ${tls}`);
    for (const t of tables) log(`  public.${t.name}: owner=${t.owner} rls=${t.rls} ${t.owned || report.bypassRls ? '' : 'NOT OWNED BY THIS ROLE'}`.trimEnd());
    log(`Bookkeeping table public.${BOOKKEEPING_TABLE}: ${bookkeepingExists ? `exists, ${recorded.length} recorded migration(s): ${recorded.join(', ') || 'none'}` : 'absent (will be created inside the lockdown transaction)'}`);
    log(`Pending: ${pending.join(', ') || 'none'}`);
    log(`Data API exposure: ${leaks.length ? leaks.join(', ') : 'none'}`);
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

export async function runDataApiLockdown(ds: DataSource, options: { check?: boolean; log?: Log } = {}): Promise<LockdownReport> {
  const log = options.log ?? (() => undefined);
  const before = await inspectDataApiLockdown(ds, log);
  if (before.schema !== 'public') throw new Error(`Refusing to run: current schema is ${JSON.stringify(before.schema)}, expected "public" (check search_path)`);
  if (options.check) {
    log('Check only: no changes were made.');
    return before;
  }

  if (before.bookkeepingExists) {
    if (before.leaks.some((l) => l.endsWith(`:${BOOKKEEPING_TABLE}`) || l.endsWith(`:${BOOKKEEPING_TABLE}_id_seq`))) {
      log(`WARNING: public.${BOOKKEEPING_TABLE} was reachable by the Data API before this run; review the recorded migrations listed above for forged rows.`);
    }
    await inTransaction(ds, async (q) => {
      await q.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      await assertPublicSchema(q);
      await lockDownRelations(q, [BOOKKEEPING_TABLE]);
    });
    log(`Bookkeeping table protected (committed separately; history kept).`);
  }

  let executed: string[] = [];
  await inTransaction(ds, async (q) => {
    await q.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await assertPublicSchema(q);
    // The executor reuses our open transaction: it neither commits nor rolls back itself.
    executed = (await new MigrationExecutor(ds, q).executePendingMigrations()).map(migrationName);
    const leaks = await findDataApiLeaks(q, await presentTables(q, [...EXISTING_APP_TABLES, BOOKKEEPING_TABLE]));
    if (leaks.length) throw new Error(`Data API roles still have access after the lockdown: ${leaks.join(', ')}`);
  });
  log(executed.length ? `Executed: ${executed.join(', ')}` : 'No migrations were pending.');

  const after = await inspectDataApiLockdown(ds, log);
  if (after.leaks.length || after.pending.length) throw new Error('Post-commit verification failed; see the report above');
  log('Verified: RLS enabled and no anon/authenticated access on any protected table or sequence.');
  return after;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  (async () => {
    let ds: DataSource | undefined;
    try {
      ds = (await import('./data-source-lockdown')).LockdownDataSource;
      await ds.initialize();
      await runDataApiLockdown(ds, { check, log: (line) => console.log(line) });
    } catch (error: any) {
      const code = error?.code ? ` [${error.code}]` : '';
      console.error(`Data API lockdown ${check ? 'check' : 'run'} failed${code}: ${redactConnectionSecrets(String(error?.message ?? error))}`);
      process.exitCode = 1;
    } finally {
      if (ds?.isInitialized) await ds.destroy();
    }
  })();
}
