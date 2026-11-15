import { MigrationInterface, QueryRunner } from 'typeorm';

// Supabase exposes tables in the public schema through its Data API (PostgREST) to the
// `anon` and `authenticated` roles, and by default grants them privileges on new tables.
// The anon key is public, so without this lockdown anyone could read or insert integration
// credentials (forging Eden access to any household) or read operation receipts.
// The application never uses these tables through the Data API: the backend connects as the
// table owner (which RLS without FORCE does not restrict). Enabling RLS with no policies plus
// revoking the role grants denies the Data API completely. Idempotent; safe on plain
// PostgreSQL, where the Supabase roles do not exist.
// `migrations` is TypeORM's bookkeeping table, also created in public by the migration runner.
const TABLES = ['integration_credentials', 'shopping_operations', 'hidden_products', 'migrations'];

export class EdenDataApiLockdown1794096002000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    for (const table of ['integration_credentials', 'shopping_operations']) {
      if (!await q.hasTable(table)) throw new Error('Phase A and B migrations are required');
    }
    for (const table of TABLES) {
      if (!await q.hasTable(table)) continue;
      await q.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await q.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON TABLE ${table} FROM anon'; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON TABLE ${table} FROM authenticated'; END IF;
      END $$`);
    }
  }

  // Deliberately keeps the lockdown: re-granting Data API access would reopen credential
  // forgery. Rolling back the earlier migrations drops these tables anyway.
  async down(): Promise<void> {}
}
