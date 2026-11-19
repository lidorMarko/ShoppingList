# Production release — Eden integration (Render, Vercel, Supabase)

Status (2026-11-16): locally validated on `feature/eden-integration-api`; **not deployed**. Nothing below has been run against production. Every step marked **[approval]** changes production.

> **Do section 0 first, independently of the Eden release.** The 2026-11-16 read-only audit found all nine existing `public` tables with RLS off, no policies, and SELECT/INSERT/UPDATE/DELETE granted to `anon` and `authenticated`: anyone with the public anon key can read or rewrite every household's data through the Supabase Data API.

## 0. Security release: Data API lockdown (ship before anything else; no application deploy)

Two separate database changes, applied in this order:

- **0-A Future-object hardening** ([`backend/sql/public-default-privileges-hardening.sql`](../backend/sql/public-default-privileges-hardening.sql), SQL editor). Changes only the default privileges of role `postgres` in schema `public`. Tables, views and sequences that `postgres` creates later get no automatic `anon`/`authenticated` privileges. `service_role` defaults are kept. It touches no existing object and no other schema.
- **0-B Existing-table lockdown** (migration `1794095990000-existing-tables-data-api-lockdown`, run with `npm run migration:run:data-api-lockdown`). Covers `profiles`, `families`, `categories`, `products`, `shopping_lists`, `list_items`, `shopping_sessions`, `session_items`, `hidden_products`, and TypeORM's `migrations` table with its `migrations_id_seq`. On each it enables RLS with no policies and revokes all privileges from `anon`, `authenticated` and `PUBLIC`.

**Why it is safe for the running application.** Neither `main` (running today) nor this branch touches tables through the Data API. The browser uses Supabase only for Auth. The backend uses TypeORM as `postgres` and its service-role client only for Storage. `postgres` owns every table and has BYPASSRLS (audit C), so RLS does not restrict it. `service_role` keeps its access deliberately: its key is secret, it has BYPASSRLS, and the backend uses it for Storage only. Auth, Storage and every other schema are untouched. Tests verify that their ACLs, RLS and default privileges are byte-identical before and after.

**Safeguards in 0-B.**
- **Preconditions:** it refuses unless the current schema is `public`. Every name is schema-qualified. The running role must own every table (or bypass RLS), and no table may FORCE RLS on a non-bypassing role.
- **Effective-privilege check:** `anon`/`authenticated` must have no privilege at all, including MAINTAIN on PostgreSQL 17, through any route: direct grant, `PUBLIC`, or an inherited role. This covers tables, columns and the bookkeeping sequence. Otherwise the transaction rolls back.
- **Bounded locks:** `lock_timeout` is 5 s.
- **Bookkeeping protection:** the runner never leaves TypeORM's bookkeeping table exposed (see step 4). The plain TypeORM CLI would create it before opening its transaction.
- **Idempotent;** its revert keeps the lockdown.

**Locking and interruption risk.** No downtime is guaranteed.
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` takes an ACCESS EXCLUSIVE lock on each of the 10 tables, held until commit. The whole transaction normally takes well under a second. During it, application queries on those tables wait.
- If any lock is not granted within 5 s (for example, a long transaction holds it), the run fails with `55P03` and rolls back completely. Requests that queued behind it may be delayed by up to about 5 s.
- Run at low traffic, right after confirming no long transactions (step 7). No restart or redeploy is needed.

**Known limits** (not changed; decisions recorded here):
- **`supabase_admin` default privileges in `public`** still grant `anon`/`authenticated` on objects *that role* creates. `postgres` is not a member of `supabase_admin` and cannot alter them, and they govern objects Supabase itself manages. Application objects are created by `postgres`, the migration role. Check that `public` objects owned by `supabase_admin` stay at zero (step 1f).
- **Built-in EXECUTE-to-PUBLIC for functions** (and so for `anon`) cannot be removed by a per-schema default. The global form would change `postgres`'s functions in every schema, so that needs a separate decision. Rule for now: any function created in `public` must run `REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon, authenticated;`. Today `public` has no functions (audit B/G).
- **The Data API key-holder model:** `service_role` (secret) keeps full table access.

### Steps

1. **Read-only preflight** (SQL editor as `postgres`; no approval needed):
   ```sql
   -- 1a. Owners, RLS and Data API access of the public tables (expect 9 rows, owner postgres, force_rls false)
   select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon,
          has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as auth
   from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1;
   -- 1b. Bookkeeping table (expect null; if not null, step 8 locks it first and prints its rows for review)
   select to_regclass('public.migrations');
   -- 1c. Other grantees on public tables (expect only anon, authenticated, postgres, service_role)
   select grantee, table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants
    where table_schema = 'public' and grantee not in ('anon','authenticated','service_role','postgres') group by 1, 2;
   -- 1d. Views, matviews, foreign/partitioned tables, sequences, functions in public (expect no rows)
   select relname, relkind from pg_class where relnamespace = 'public'::regnamespace and relkind in ('v','m','f','p','S');
   select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace;
   -- 1e. Triggers and Realtime publications on public (expect no rows)
   select event_object_table, trigger_name from information_schema.triggers where event_object_schema in ('public','auth');
   select pubname, tablename from pg_publication_tables where schemaname = 'public';
   -- 1f. Default privileges, including global rows, and public objects owned by supabase_admin (expect 0)
   select coalesce(nullif(defaclnamespace, 0::oid)::regnamespace::text, '(all schemas)') as schema, defaclrole::regrole, defaclobjtype, defaclacl
     from pg_default_acl where defaclnamespace in (0::oid, 'public'::regnamespace) order by 1, 2, 3;
   select count(*) from pg_class where relnamespace = 'public'::regnamespace and relowner = 'supabase_admin'::regrole;
   -- 1g. Data API role memberships (expect authenticator -> anon, authenticated, service_role only)
   select roleid::regrole as granted, member::regrole as member from pg_auth_members
    where member in ('anon'::regrole, 'authenticated'::regrole, 'authenticator'::regrole) order by 2, 1;
   ```
   Stop if any result differs from the expectation. In particular, a global `(all schemas)` row for `postgres` that grants `anon`/`authenticated` on tables would not be removed by 0-A.
2. **[approval] Optional immediate containment** (instant, reversible, no database change): Dashboard → Settings → API (Data API) → remove `public` from *Exposed schemas*. `pg_graphql` is not installed (audit F), so PostgREST is the only table API. Check with no rows read:
   `curl -s -o /dev/null -w '%{http_code}\n' "$SUPABASE_URL/rest/v1/profiles?select=id&limit=0" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"`
   It returns 200 while exposed and 401 after step 8 if `public` is still exposed. Once `public` is no longer exposed it returns 404 `PGRST205` (the request falls back to `graphql_public`). Adding `-H "Accept-Profile: public"` confirms the refusal with 406 `PGRST106` (observed 2026-11-19). Keep it removed afterwards as defence in depth.
3. **[approval] Default-privilege hardening (0-A):** paste [`backend/sql/public-default-privileges-hardening.sql`](../backend/sql/public-default-privileges-hardening.sql) into the SQL editor and run it as `postgres`. It runs in one transaction and is idempotent. Its final SELECT must show the `postgres` rows for `public` without `anon=` or `authenticated=`. The `supabase_admin` rows are expected to stay unchanged.
   *Reversal* (re-exposes future tables; only by decision):
   `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT <the privileges shown in preflight 1f> ON TABLES|SEQUENCES TO anon, authenticated;`
4. **Bookkeeping protection** (automatic in the runner; nothing to run).
   - When `public.migrations` is absent (expected), the runner creates it inside the lockdown transaction, using TypeORM's own DDL on the runner's query runner. A failure rolls the creation back with everything else.
   - When it already exists, the runner first locks it down (RLS, revokes on the table and `migrations_id_seq`) in its own committed transaction, keeping every history row. It then prints the recorded names for review, warning if the table was reachable before.
   - After 0-A, even a table created by the plain TypeORM CLI gets no Data API grants.
5. **Operator shell with verified TLS.** Use a checkout of the approved commit and run `npm ci`.
   - **CA certificate:** Dashboard → Project Settings → Database → SSL configuration → *Download certificate*. The file is public, not a secret. Then `export NODE_EXTRA_CA_CERTS=/absolute/path/prod-ca-2021.crt`.
   - **Connection string:** `read -rs DATABASE_URL && export DATABASE_URL`, then paste it. It is not echoed and stays out of shell history. Use the **session pooler** (`postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432/postgres`) or the direct host (`db.<project-ref>.supabase.co:5432`, IPv6-only without the IPv4 add-on). Never use the transaction pooler (port 6543).
   - **URL rules:** a host name (IP addresses are refused, because node-postgres would skip host-name verification), and no query parameters other than optional `sslmode=verify-full` or `sslrootcert=<CA file>`. Leave `DATABASE_SSL` unset or `true`.
   - **What is refused** before connecting, without printing the URL or password: `sslmode` other than `verify-full`, `ssl=…`, `uselibpqcompat`, `options`, unknown parameters, IP hosts, and `DATABASE_SSL=false` for a non-loopback host.
6. **Direct-connection role and schema verification** (read-only; it runs only SELECTs):
   `npm run migration:check:data-api-lockdown --workspace=backend`
   Expected:
   - `Connected as postgres (superuser=false, bypassrls=true); current schema public; server 17…; TLS required, server certificate and host name verified`
   - the nine tables with `owner=postgres rls=false`
   - `Bookkeeping table public.migrations: absent`
   - `Pending: ExistingTablesDataApiLockdown1794095990000`
   - `Other transactions open longer than 5s: 0`
   - `Check only: no changes were made.`

   This also confirms the CA set-up. A `SELF_SIGNED_CERT_IN_CHAIN` error means `NODE_EXTRA_CA_CERTS` is missing or wrong. Stop if the role is not `postgres`, the schema is not `public`, or any table is not owned by this role.
7. **Immediately before step 8**, re-run the long-transaction check (expect no rows):
   ```sql
   select pid, usename, state, now() - xact_start as age, left(query, 80) from pg_stat_activity
    where xact_start is not null and pid <> pg_backend_pid() and now() - xact_start > interval '5 seconds' order by xact_start;
   ```
8. **[approval] Existing-table lockdown (0-B):** `npm run migration:run:data-api-lockdown --workspace=backend`
   The run should end with:
   `Executed: ExistingTablesDataApiLockdown1794095990000`, then `Data API exposure: none` and `Verified: RLS enabled and no anon/authenticated access on any protected table or sequence.`
   Exit status 0. Re-running it is a no-op ("No migrations were pending").
9. **Post-migration SQL verification** (read-only):
   ```sql
   -- expect 10 rows (nine tables + migrations): rls true, anon_any false, auth_any false
   select c.relname, c.relrowsecurity as rls,
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') as anon_any,
          has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') as auth_any
   from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1;
   -- expect migrations_id_seq | false
   select relname, has_sequence_privilege('anon', oid, 'USAGE,SELECT,UPDATE') or has_sequence_privilege('authenticated', oid, 'USAGE,SELECT,UPDATE') as data_api
     from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S';
   -- expect exactly one row: ExistingTablesDataApiLockdown1794095990000
   select id, "timestamp", name from public.migrations order by id;
   ```
   Repeat the curl from step 2: expect 401 (or 404 `PGRST205` / 406 `PGRST106` with `Accept-Profile: public` if `public` is no longer exposed).
10. **Production smoke tests:** in the live web app:
    - log in and out
    - open lists; add, check and uncheck an item; edit a quantity
    - products: list, add, and hide/unhide
    - family view
    - start and complete a shopping session, with a receipt upload
    - product images

    Render logs must show no new `permission denied` or empty-result errors. Supabase Auth sign-in and Storage uploads must keep working.
11. **Failure handling and recovery:**

    | Symptom | State | Action |
    |---|---|---|
    | Refused before connecting (URL/TLS rule), `SELF_SIGNED_CERT_IN_CHAIN`, `ERR_TLS_CERT_ALTNAME_INVALID`, authentication error | Nothing changed | Fix the shell settings (step 5); never disable verification |
    | `[55P03] … lock timeout` | Fully rolled back; `public.migrations` not created | Find the lock holder (step 7 query); retry when idle |
    | `Data API roles still have table access …`, `Run this migration as the backend table owner …`, `Required application table … is missing`, `current schema is …` | Fully rolled back; a pre-existing `migrations` table stays protected (step 4) | Investigate with preflight 1a/1c/1g; do not retry blindly |
    | `Post-commit verification failed` | Lockdown committed, but something still reaches a table | Run step 9; investigate the listed role/table; containment (step 2) meanwhile |
    | Application breaks after success (not expected) | Lockdown committed | Collect the error. Last resort, per affected table: `ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;` (keeps the revokes). **Never re-grant `anon`/`authenticated`.** Re-add `public` to Exposed schemas only while the revokes stay in place |

12. **Separate, later work** (each its own approval; not part of this release):
    - **Rotate family invite codes.** `families.inviteCode` was readable, and any signed-in account can join a household with a code (`POST /families/join`).
    - **Secure the legacy public buckets** (`product-images`, `receipts`): receipt and image URLs were readable. Making the buckets private requires this branch's media proxy (section 2, step 4).
    - **Review historical access.** `pg_stat_statements` was reset on 2026-11-16 07:30 UTC, so it cannot prove there was no access before then. Check the Supabase API/edge logs within the plan's retention, and the integrity of `profiles` (`familyId`, `familyRole`), `families` and `products`.
    - **Render TLS before deploying this branch:** see the environment variables below.
    - **The Eden integration release:** sections 1–2.

Local evidence (2026-11-16, this branch; the commands are listed in [EDEN_INTEGRATION_SECURITY.md](EDEN_INTEGRATION_SECURITY.md)):
- **Supabase replica** (`supabase/postgres:17.6.1.054` with real Supabase roles and default privileges): lockdown suite 11/11, plus the real `npm` commands run end to end.
- **Backend:** HTTP/security plus migration-connection TLS tests 38/38.
- **PostgreSQL 16:** existing-tables lockdown 7/7; Eden Data API lockdown 4/4; migrations 10/10; operation-migrations 5/5; operations 52/52.
- **Live TLS check** against a local server with a private CA chain: fails without the CA, passes with `NODE_EXTRA_CA_CERTS` or `sslrootcert`, and rejects a wrong CA, a non-TLS server and a mismatched host name.
- **Builds:** backend and frontend typecheck and build.
- **Recorded in earlier sessions, not re-run after these changes:** Eden `9c3e933` real-HTTP end-to-end 10/10 (this backend as a non-superuser, non-BYPASSRLS owner after all four migrations) and Chromium media/consent 3/3.

Production readiness is **not** established until the preflight and post-migration checks pass.

## What changes

| Component | Change |
|---|---|
| Database | Section 0 first, on its own: default-privilege hardening (SQL) and `1794095990000-existing-tables-data-api-lockdown`. Then three additive migrations, in order: `1794096000000-eden-security` (integration credentials, hidden-product uniqueness), `1794096001000-shopping-operations` (idempotent operation ledger, write scope), `1794096002000-eden-data-api-lockdown` (RLS on, `anon`/`authenticated` privileges revoked on the integration tables and TypeORM's `migrations` table). `synchronize` is off; nothing runs on startup. |
| Backend (Render) | Supabase Auth via publishable key; access policy; Eden credential endpoints; private media proxy. Verifies database TLS, so it needs the Supabase CA (see below). |
| Frontend (Vercel) | Authenticated blob loading for images/receipts; `/integrations/eden` consent page. Must ship with the backend. |
| Storage | New uploads go to private `product-images-private` / `receipts-private`. Legacy `product-images` / `receipts` objects are served only through the authorized API, and only once their buckets are private. No object is moved or deleted. Downloads are proxied (no signed URLs or tokens in URLs). |

## Environment variables (names only)

| Where | Name | Notes |
|---|---|---|
| Render (backend) | `EDEN_INTEGRATION_ENABLED` | `false` at first deploy; `true` only at activation |
| Render | `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) | **Required before deploy**: routine web auth fails closed without it |
| Render | `ADMIN_EMAIL` | category / global-product writes |
| Render | `DATABASE_SSL` | keep TLS verification on (`true`/unset) |
| Render | `NODE_EXTRA_CA_CERTS` | **Required before deploying this branch.** Upload Supabase's CA as a Render *Secret File* (e.g. `prod-ca-2021.crt`, available at `/etc/secrets/prod-ca-2021.crt`) and point this variable at it. This branch verifies the database certificate, and Supabase's chain is self-signed, so without the CA the backend cannot connect at all. The code on `main` that runs today disables verification. Keep `DATABASE_URL`'s host a DNS name. This is separate from the section 0 release, which needs no Render change. |
| Render (existing) | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (storage only), `OPENAI_API_KEY`, `FRONTEND_URL`, `APP_INVITE_CODE`, `PORT`, `NODE_ENV` | unchanged |
| Vercel (frontend) | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | existing |
| Migration operator shell | `DATABASE_URL` (session pooler or direct host, port 5432, DNS host name; not the transaction pooler), `NODE_EXTRA_CA_CERTS` (Supabase CA file), `DATABASE_SSL` (unset/`true`) | supplied explicitly; the CLIs never read `.env`, refuse TLS-weakening URL parameters, and never print the URL or password |

## 1. Read-only preflight (Supabase SQL editor) — no approval needed, changes nothing

```sql
-- a. Buckets and their public flag
select id, public from storage.buckets order by id;
-- b. Direct-object policies (bucket public=false is not enough if these allow anon/authenticated)
select policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';
-- c. Data API exposure of every public table (pre-existing tables included)
select c.relname, c.relrowsecurity,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('anon', c.oid, 'insert') as anon_insert,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
-- d. Existing schema state (after section 0: migrations exists with exactly the lockdown row; the others null, except possibly hidden_products)
select to_regclass('public.integration_credentials'), to_regclass('public.shopping_operations'),
       to_regclass('public.hidden_products'), to_regclass('public.migrations');
select name from public.migrations order by id;
-- e. Only if hidden_products exists: duplicates block the unique index (migration fails safely)
select "userId", "productId", count(*) from hidden_products group by 1, 2 having count(*) > 1;
-- f. Legacy media references the new strict parser cannot serve (they would stop rendering, not be lost)
select count(*) filter (where "imageUrl" is not null and "imageUrl" !~ '/storage/v1/object/public/product-images(-private)?/([0-9a-f-]{36}/)?[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif)$') as nonconforming_images,
       count("imageUrl") as images from products;
select count(*) filter (where "receiptUrl" is not null and "receiptUrl" not like 'private:%' and "receiptUrl" !~ '/storage/v1/object/public/receipts/[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp|pdf)$') as nonconforming_receipts,
       count("receiptUrl") as receipts from shopping_sessions;
-- g. Run as the backend's DATABASE_URL role: credential verification reads auth.users
select current_user, has_table_privilege(current_user, 'auth.users', 'select');
```

Go only if:
- (c) shows RLS on and no `anon`/`authenticated` access for every pre-existing table, meaning section 0 is complete;
- (d) lists only `ExistingTablesDataApiLockdown1794095990000`;
- (e) is empty;
- (f) nonconforming counts are understood;
- (g) is `true`.

### 1-alt. Eden release while section 0 is postponed (decision 2026-11-17)

Section 0 is postponed by the owner. The Eden release may proceed only with these substitutes:

- **Data API containment first (section 0, step 2):** `public` is removed from Supabase *Exposed schemas*, and the step 2 curl check is refused (404 `PGRST205`; 406 `PGRST106` with `Accept-Profile: public`). Verified on production 2026-11-19. Without it, `profiles.familyId` (household membership) stays writable with the public anon key, so Eden's household authorization could be redirected. Neither the frontend nor the backend uses the Data API (Auth and Storage only), so the application is unaffected. Keep `public` unexposed until section 0 ships.
- **Eden-only migration runner:** `npm run migration:check:eden --workspace=backend` (read-only), then **[approval]** `npm run migration:run:eden --workspace=backend`, in the operator shell from section 0, step 5. It applies only `1794096000000`, `1794096001000` and `1794096002000`, and never `1794095990000`. In one transaction it creates `public.migrations`, runs the three migrations, and enables RLS on, and revokes `anon`/`authenticated` from, `migrations`, `migrations_id_seq`, `integration_credentials`, `shopping_operations` and `hidden_products`. It verifies that no Data API access remains before committing. Any failure rolls back all of it. It refuses to run if `hidden_products` has duplicates. **Do not use plain `migration:run` while section 0 is postponed**, because its data source runs `1794095990000` first. Section 0 can still run later with its own runner (tested in `test/eden-migrations-runner.cjs`, 5/5).
- Preflight (1c) and (d) do not apply in this mode. The other eight existing tables keep their current RLS and grants until section 0.

## 2. Release order

1. **[approval] Storage buckets** (Dashboard → Storage, or SQL). Create `product-images-private` and `receipts-private` as **private** if absent. Do not touch the legacy buckets yet. No `storage.objects` policy is needed for the backend (it uses the service role); remove/avoid any policy granting `anon`/`authenticated` access to these buckets.
2. **[approval] Migrations** from this branch's backend, in the operator shell from section 0, step 5 (`NODE_EXTRA_CA_CERTS`, host-name `DATABASE_URL`):
   `npm run migration:run --workspace=backend`
   The bookkeeping table already exists and is locked from section 0, so the TypeORM CLI adds rows only inside its transaction. Then re-run preflight (c)/(d): the three integration tables and `migrations` must show `relrowsecurity = true` and no `anon`/`authenticated` privileges.
3. **[approval] Render backend**: upload the Supabase CA as a Secret File and set `NODE_EXTRA_CA_CERTS` (see environment variables). Set `SUPABASE_PUBLISHABLE_KEY` and `ADMIN_EMAIL`, and keep `EDEN_INTEGRATION_ENABLED=false`. Deploy this branch's commit after it is merged to the deploy branch. Confirm in the Render logs that the database connects; a TLS error means the CA is missing. **[approval] Vercel frontend**: deploy the same commit. Release both together.
4. **[approval] Make legacy buckets private** (`product-images`, `receipts`): Dashboard toggle, or
   `update storage.buckets set public = false where id in ('product-images', 'receipts');`
   Immediately verify in the web app: product images, receipt image, receipt PDF, new upload. Between steps 3 and 4 legacy media fail closed (not rendered); keep that window short.
5. Verify while the flag is off: unauthenticated `GET <backend>/api/integrations/eden/self` → **401 or 404** (the auth guard may answer first); never 2xx. Existing web login, lists and media work.
6. **[approval] Activate**: `EDEN_INTEGRATION_ENABLED=true` on Render; redeploy/restart. Unauthenticated `/api/integrations/eden/self` → **401**.
7. Sign in, open `/integrations/eden`, authorize read + write; connect Eden (`shopping:connect -- --allow-write`, see Eden's `docs/ShoppingList-Integration.md`).
8. Household check: in Eden, `איזה רשימות קניות יש לי?` lists only your household's lists; one confirmed add appears in the web app on the right list; a member of another household sees nothing.

## 3. Rollback

- Integration only: `EDEN_INTEGRATION_ENABLED=false` (integration credentials stop working; their routes are refused).  Revoke the credential in `/integrations/eden` if exposed.
- Code: redeploy the previous Render/Vercel commits. Note the previous code reads legacy media through **public** URLs; if step 4 was done, either keep the new code or set the legacy buckets back to public (`update storage.buckets set public = true where id in ('product-images','receipts');`) — only if that exposure is acceptable.
- Database: migrations are additive and the previous code ignores the new tables, so leaving them in place is the safe default. `migration:revert` exists (the lockdown's revert is a deliberate no-op; reverting the ledger downgrades and revokes write grants; reverting the security migration drops all integration credentials). Never re-grant Data API access to these tables.
- Storage: no objects are moved or deleted at any step.
