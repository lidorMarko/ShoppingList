-- Future-object hardening for the Supabase Data API (ShoppingList).
-- Separate from, and run before, the existing-table lockdown migration. Idempotent.
-- Run as `postgres` (Supabase SQL editor). It changes ONLY the default privileges that role
-- postgres applies to objects it creates in schema public:
--   * new tables, views and sequences: no automatic privileges for anon / authenticated;
--   * new functions: no explicit per-schema EXECUTE grant to anon / authenticated.
-- service_role keeps its defaults (secret key, BYPASSRLS; used by the backend for Storage).
--
-- Deliberately NOT changed (see docs/PRODUCTION_RELEASE.md, "Default privileges"):
--   * supabase_admin's defaults in public: postgres is not a member of supabase_admin and cannot
--     alter them, and they govern objects Supabase itself creates. Application objects are
--     created by postgres (the migration role), so they are covered here.
--   * PostgreSQL's built-in EXECUTE-to-PUBLIC default for functions (and therefore for anon):
--     a per-schema default cannot remove it, and the global form would change postgres's
--     functions in every schema. Every future function in public must revoke it explicitly:
--       REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon, authenticated;
--   * Defaults in auth, storage, realtime, extensions, graphql, graphql_public, vault.
BEGIN;

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run as postgres (current_user is %)', current_user;
  END IF;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

COMMIT;

-- Verification (read-only): the postgres rows for schema public must not mention anon or authenticated.
SELECT defaclrole::regrole AS creator, defaclobjtype AS object_type, defaclacl AS acl
  FROM pg_default_acl
 WHERE defaclnamespace = 'public'::regnamespace
 ORDER BY 1, 2;
