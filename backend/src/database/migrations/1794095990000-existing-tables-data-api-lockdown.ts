import { MigrationInterface, QueryRunner } from 'typeorm';

// Supabase exposes the public schema through its Data API (PostgREST) as the `anon` and
// `authenticated` roles. The production audit found every application table with RLS off and
// SELECT/INSERT/UPDATE/DELETE granted to both roles, so anyone holding the public anon key could
// read or rewrite every household's data directly, bypassing the backend's authorization.
// Neither the web app nor the backend uses the Data API for tables: the browser uses Supabase
// Auth only, and the backend uses TypeORM as the table owner (RLS without FORCE does not apply to
// the owner). This enables RLS with no policies and revokes the Data API roles (and PUBLIC),
// including on TypeORM's bookkeeping table and its id sequence. `service_role` is deliberately
// untouched (secret key, BYPASSRLS, used by the backend for Storage only).
// Every name is schema-qualified with `public`, and the migration refuses to run unless the
// session's current schema is `public` (TypeORM records migrations there). A bounded lock
// timeout makes it fail and roll back instead of queueing application queries indefinitely.
// Run it with `npm run migration:run:data-api-lockdown`, which keeps the bookkeeping table
// protected even when this migration fails. Idempotent; a no-op for absent roles.
export const SCHEMA = 'public';
export const EXISTING_APP_TABLES = [
  'profiles', 'families', 'categories', 'products', 'shopping_lists',
  'list_items', 'shopping_sessions', 'session_items', 'hidden_products',
];
export const BOOKKEEPING_TABLE = 'migrations';
export const LOCK_TIMEOUT = '5s';
export const DATA_API_ROLES = ['anon', 'authenticated'];
// hidden_products may be absent on older installations (Eden's first migration creates it).
const OPTIONAL = new Set(['hidden_products', BOOKKEEPING_TABLE]);

const qualified = (table: string) => `"${SCHEMA}"."${table}"`;

export async function assertPublicSchema(q: QueryRunner): Promise<void> {
  const [{ schema }] = await q.query('SELECT current_schema() AS schema');
  if (schema !== SCHEMA) {
    throw new Error(`Refusing to run: current schema is ${JSON.stringify(schema)}, expected "public" (check search_path)`);
  }
}

// Ordinary tables of the given names that exist in public (never another schema).
export async function presentTables(q: QueryRunner, names: string[]): Promise<string[]> {
  const rows: { relname: string }[] = await q.query(
    `SELECT c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relname = ANY($1::text[])`,
    [names],
  );
  const found = new Set(rows.map((r) => r.relname));
  return names.filter((n) => found.has(n));
}

// Sequences owned by columns of the given public tables (serial / identity), schema-qualified.
async function ownedSequences(q: QueryRunner, tables: string[]): Promise<string[]> {
  const rows: { seq: string }[] = await q.query(
    `SELECT DISTINCT format('%I.%I', sn.nspname, s.relname) AS seq
       FROM pg_class t
       JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = t.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
       JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
       JOIN pg_namespace sn ON sn.oid = s.relnamespace
      WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY($1::text[])
      ORDER BY 1`,
    [tables],
  );
  return rows.map((r) => r.seq);
}

async function revokeTargets(q: QueryRunner): Promise<string> {
  const roles: { rolname: string }[] = await q.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY 1', [DATA_API_ROLES]);
  return ['PUBLIC', ...roles.map((r) => `"${r.rolname}"`)].join(', ');
}

// Enables RLS (no policies) and revokes PUBLIC and the Data API roles on each table and on the
// sequences its columns own. Names come from the fixed lists above, never from input.
export async function lockDownRelations(q: QueryRunner, tables: string[]): Promise<void> {
  const targets = await revokeTargets(q);
  for (const table of tables) {
    await q.query(`ALTER TABLE ${qualified(table)} ENABLE ROW LEVEL SECURITY`);
    await q.query(`REVOKE ALL ON TABLE ${qualified(table)} FROM ${targets}`);
  }
  for (const seq of await ownedSequences(q, tables)) await q.query(`REVOKE ALL ON SEQUENCE ${seq} FROM ${targets}`);
}

// Any remaining effective access (direct, via PUBLIC, or via inherited role membership) of a
// Data API role to the tables, their columns or their owned sequences, or a table without RLS.
export async function findDataApiLeaks(q: QueryRunner, tables: string[]): Promise<string[]> {
  const [{ version }] = await q.query(`SELECT current_setting('server_version_num')::int AS version`);
  const privileges = `SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${version >= 170000 ? ',MAINTAIN' : ''}`;
  const rows: { leak: string }[] = await q.query(
    `SELECT r.rolname || ':' || c.relname AS leak FROM pg_class c
       JOIN pg_roles r ON r.rolname = ANY($2::text[])
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[])
        AND (has_table_privilege(r.oid, c.oid, '${privileges}') OR has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
     UNION ALL
     SELECT 'rls-off:' || c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[]) AND NOT c.relrowsecurity
     UNION ALL
     SELECT r.rolname || ':' || s.relname FROM pg_class t
       JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = t.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
       JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
       JOIN pg_roles r ON r.rolname = ANY($2::text[])
      WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY($1::text[])
        AND has_sequence_privilege(r.oid, s.oid, 'USAGE,SELECT,UPDATE')
     ORDER BY 1`,
    [tables, DATA_API_ROLES],
  );
  return rows.map((r) => r.leak);
}

export class ExistingTablesDataApiLockdown1794095990000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Effective only inside the migration transaction; bounds every lock wait below.
    await q.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await assertPublicSchema(q);

    const wanted = [...EXISTING_APP_TABLES, BOOKKEEPING_TABLE];
    const tables = await presentTables(q, wanted);
    const missing = wanted.filter((t) => !tables.includes(t) && !OPTIONAL.has(t));
    if (missing.length) throw new Error(`Required application table ${missing.join(', ')} is missing from public`);

    // Enabling RLS must never lock out the backend. Refuse unless the role running this migration
    // (which must be the backend's DATABASE_URL role) owns every table or bypasses RLS, and no
    // table forces RLS onto a role that does not bypass it.
    const unsafe: { relname: string }[] = await q.query(
      `SELECT c.relname FROM pg_class c
         JOIN pg_roles r ON r.rolname = current_user
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[])
          AND NOT (r.rolsuper OR r.rolbypassrls)
          AND (NOT pg_has_role(current_user, c.relowner, 'USAGE') OR c.relforcerowsecurity)
        ORDER BY 1`,
      [tables],
    );
    if (unsafe.length) {
      throw new Error(`Run this migration as the backend table owner; RLS would block it on: ${unsafe.map((t) => t.relname).join(', ')}`);
    }

    await lockDownRelations(q, tables);

    // Fail closed (the whole transaction rolls back) if a Data API role still reaches anything,
    // e.g. through membership in another role that holds grants.
    const leaks = await findDataApiLeaks(q, tables);
    if (leaks.length) throw new Error(`Data API roles still have table access: ${leaks.join(', ')}`);
  }

  // Deliberately keeps the lockdown: re-granting Data API access would re-expose every
  // household's data. Manual, reviewed SQL is documented in docs/PRODUCTION_RELEASE.md.
  async down(): Promise<void> {}
}
