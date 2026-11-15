# Production release — Eden integration (Render, Vercel, Supabase)

Status (2026-11-15): locally validated on `feature/eden-integration-api`; **not deployed**. Nothing below has been run against production. Every step marked **[approval]** changes production.

Local evidence: backend HTTP/security 32/32; PostgreSQL migration 10/10, operation-migration 5/5, operations 52/52, Data API lockdown 4/4 (PostgreSQL 16); Chromium media/consent 3/3; backend/frontend typecheck and build; Eden `9c3e933` real-HTTP end-to-end 10/10 against this backend with all three migrations. Production readiness is **not** established until the preflight and post-deploy checks below pass.

## What changes

| Component | Change |
|---|---|
| Database | Three additive migrations, in order: `1794096000000-eden-security` (integration credentials, hidden-product uniqueness), `1794096001000-shopping-operations` (idempotent operation ledger, write scope), `1794096002000-eden-data-api-lockdown` (RLS on, `anon`/`authenticated` privileges revoked on the integration tables and TypeORM's `migrations` table). `synchronize` is off; nothing runs on startup. |
| Backend (Render) | Supabase Auth via publishable key; access policy; Eden credential endpoints; private media proxy. |
| Frontend (Vercel) | Authenticated blob loading for images/receipts; `/integrations/eden` consent page. Must ship with the backend. |
| Storage | New uploads go to private `product-images-private` / `receipts-private`. Legacy `product-images` / `receipts` objects are served only through the authorized API, and only once their buckets are private. No object is moved or deleted. Downloads are proxied (no signed URLs or tokens in URLs). |

## Environment variables (names only)

| Where | Name | Notes |
|---|---|---|
| Render (backend) | `EDEN_INTEGRATION_ENABLED` | `false` at first deploy; `true` only at activation |
| Render | `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) | **Required before deploy**: routine web auth fails closed without it |
| Render | `ADMIN_EMAIL` | category / global-product writes |
| Render | `DATABASE_SSL` | keep TLS verification on (`true`/unset) |
| Render (existing) | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (storage only), `OPENAI_API_KEY`, `FRONTEND_URL`, `APP_INVITE_CODE`, `PORT`, `NODE_ENV` | unchanged |
| Vercel (frontend) | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | existing |
| Migration operator shell | `DATABASE_URL` (direct connection, port 5432, not the transaction pooler), `DATABASE_SSL` | supplied explicitly; the CLI never reads `.env` |

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
-- d. Existing schema state (all four should be null before the first release, except possibly hidden_products)
select to_regclass('public.integration_credentials'), to_regclass('public.shopping_operations'),
       to_regclass('public.hidden_products'), to_regclass('public.migrations');
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

Go only if: (c) shows no unexpected `anon`/`authenticated` access to sensitive pre-existing tables (if it does, that is an existing exposure to fix before or alongside this release); (e) is empty; (f) nonconforming counts are understood; (g) is `true`.

## 2. Release order

1. **[approval] Storage buckets** (Dashboard → Storage, or SQL). Create `product-images-private` and `receipts-private` as **private** if absent. Do not touch the legacy buckets yet. No `storage.objects` policy is needed for the backend (it uses the service role); remove/avoid any policy granting `anon`/`authenticated` access to these buckets.
2. **[approval] Migrations** from this branch's backend, with explicit settings:
   `DATABASE_URL=<direct connection> DATABASE_SSL=true npm run migration:run --workspace=backend`
   Then re-run preflight (c)/(d): the three integration tables and `migrations` must show `relrowsecurity = true` and no `anon`/`authenticated` privileges.
3. **[approval] Render backend**: set `SUPABASE_PUBLISHABLE_KEY`, `ADMIN_EMAIL`, keep `EDEN_INTEGRATION_ENABLED=false`; deploy this branch's commit (after it is merged to the deploy branch). **[approval] Vercel frontend**: deploy the same commit. Release both together.
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
