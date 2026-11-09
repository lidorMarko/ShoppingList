# Eden integration — security and existing-account credentials

Status: Phases A and B are committed locally. Phase C (credential self-inspection/self-revocation here, plus read-only Eden connection and tools in the Eden repository) is implemented and validated locally, not committed. Integration remains disabled by default, no real account is connected, and nothing is deployed. See [Phase B](PHASE_B.md) and [Phase C](PHASE_C.md). No database synchronization exists, and Eden has no write tools.

## Authentication and route policies

A global Nest guard verifies web bearer tokens with Supabase Auth getUser using SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY). The service-role key is no longer used by routine authentication. The only public route is POST /api/auth/validate-invite. The existing /auth/me onboarding flow still allows an authenticated Supabase identity to create its invited profile. Every other route requires an existing profile.

AccessPolicy is the closed controller/handler authorization manifest. New handlers fail closed until reviewed. The same policy governs web and integration principals, checks current family membership, and returns 404 for inaccessible resources. Nested list/session items must match the supplied parent. Both lists are authorized before copying, and products must be visible before addition, replacement or copying. Unknown/missing resource IDs are rejected before TypeORM queries.

Category reads are authenticated; category writes require ADMIN_EMAIL and a confirmed email from the verified Supabase Auth response (explicitly approved). Body claims and user metadata never confer admin rights. Global product edits/creation are admin-only. Current family members may edit private shared products. Deleting your own product retains existing hard-delete behavior; deleting another visible shared/global product hides it for the current family. Hiding is not an authorization grant: an unrelated product cannot be hidden by guessing its ID.

Hidden catalog entries cannot be newly added or directly fetched. Existing authorized lists/sessions retain historical hidden items and their images; hidden image access requires a current authorized list/session reference. Catalog discovery remains denied. A response interceptor redacts nested products whose owner is no longer visible, rather than returning another family's product name. Purchase-price aggregates join sessions and lists and filter current authorized owners.

## Explicit existing-account consent

The signed-in web account can open /integrations/eden. Nothing is granted automatically. Clicking Authorize Eden read access sends POST /api/integrations/eden/credentials with application=eden, consent=true, scopes=[shopping:read]. The backend derives the account from verified authentication, never body/model IDs. It issues a credential once in the no-store HTTPS response; the UI holds it only in component memory, hides it on account changes/unmount, and never writes it to localStorage, URLs, Telegram, or model context.

A token has a random UUID identifier and 256-bit random secret. ShoppingList persists only its SHA-256 verifier. High-entropy random credentials do not require password hashing. Verification uses fixed-length timing-safe digest comparison and checks expiry, revocation, existing profile, and current Supabase Auth account status. Queries check auth.users.deleted_at/banned_until using the existing server DB connection, without a Supabase service-role API key. This requires the application DB role to have SELECT access to those three Auth columns; missing permission fails closed. Account disable/delete invalidates credentials even if a profile remains.

Phase A issued shopping:read only. Phase B preserves those grants and adds explicitly consented read+write access only to reliable list/item mutation and operation recovery routes. Default consent remains read-only. Account/family/catalog/media/credential administration and integration toggles remain denied. See PHASE_B.md for the current scope and replay contract.

Expiry defaults to 30 days and is bounded to 1–90 days. DELETE /api/integrations/eden/credentials/:id revokes only the current web account's credential. POST with rotateCredentialId atomically replaces and revokes that account's old credential. Revocation/expiry is checked on every new request; already-running reads are not cancelled. List/status responses omit verifier hashes and tokens.

Transfer is manual and host-only; this phase adds no automatic browser-to-Eden callback or connected shopping adapter. Never paste a token in chat or command arguments. Eden has a standalone AES-256-GCM envelope helper bound to owner, ShoppingList user, credential, API origin, expiry and key version. Phase C adds Eden's host provisioning (`npm run shopping:connect`, masked input, dedicated key separate from PIN/Google secrets), which verifies the credential through `GET /api/integrations/eden/self` and accepts read-only grants only. No real token has been provisioned. Do not enable access merely because consent UI exists.

## Private images and receipts

New objects require preconfigured private buckets receipts-private and product-images-private. Application code does not create or change buckets. Objects are downloaded through authenticated, authorized API routes, with no-store/nosniff responses; browsers fetch blobs with the existing bearer interceptor. MIME allowlists exclude SVG/HTML. No access token or signed storage credential is placed in a URL. Storage errors use fixed responses.

Legacy storage references are parsed against the configured Supabase origin and known bucket/key patterns, never fetched as arbitrary URLs. Existing receipts and images can be served only after their legacy buckets are made private. New image references must belong to the caller/current household unless they are the product's unchanged existing reference. External arbitrary image URLs are rejected. Private uploaded image previews are household scoped before a product is created.

IMPORTANT deployment prerequisite: API code cannot retract objects in existing public buckets or invalidate copies already downloaded. Operators must separately review existing public storage, change its access policy to private, validate storage policies, and verify legacy key formats. This was NOT done. Until then, the system must not be described as fully secured or integration-enabled. The new frontend and backend must be released together for private-media viewing. Historic filenames outside the supported UUID/media extension pattern need an explicitly reviewed conversion plan.

## Explicit migrations and rollback

Both application and CLI use synchronize=false and a shared complete entity inventory. No catalog writes occur on application startup. The migration CLI does not load checkout .env files; connection settings must be supplied explicitly. TLS verifies certificates by default. DATABASE_SSL=false is only for disposable local development.

1794096000000-eden-security requires an existing application schema. It creates hidden_products only if absent, adds a unique user/product hide index, and adds integration_credentials with owner FK/cascade, token verifier/scopes/expiry constraints and user index. Existing app tables are never recreated. The representative legacy fixture is explicit synthetic DDL/data, not a production export. Duplicate hide rows fail migration transactionally; no data is silently deduplicated. Existing schema/table/index collisions must be inspected against a disposable schema copy before approval to apply.

Rollback drops integration credentials (all tokens stop working) and the added hide uniqueness index; it deliberately retains hidden_products and existing hide preferences, even if this migration created that table. Roll back application code together with schema as needed; tokens must be reauthorized after reapplying. No production migration was run.

## Validation

npm test --workspace=backend runs Node's built-in tests with local HTTP mocks, real controllers/global guards, policy/repository mocks, credential lifecycle, storage parsing/privacy and migration-runner contract checks. It does not contact Supabase/OpenAI/production or load environment files.

npm run test:migrations --workspace=backend is an opt-in real PostgreSQL harness. Supply SHOPPINGLIST_TEST_DATABASE_URL pointing to an EMPTY disposable local database named shoppinglist_eden_test_*. It refuses other hosts/names and does not read DATABASE_URL. It builds an explicit minimal installation fixture, tests migration up/down/reapply, uniqueness, scopes and FK cascade, and leaves only disposable fixture data for operator removal. No schema synchronization is used. Real PostgreSQL 17.6 validation passed against a populated synthetic legacy schema; see PHASE_A_VALIDATION.md. Each invocation requires a fresh empty disposable database, then builds/resets only its own synthetic fixtures.

Run backend/frontend TypeScript checks/builds and git diff --check. No lint command is configured. See the implementation report for actual results; passing mock tests is not production verification.

## Limits and next gates

No deployed schema, Supabase project configuration, RLS/storage policies, database-role grants or real account access were inspected. Local migration, Auth lifecycle privilege and media regression tests passed. Deployed private-storage/account-lifecycle smoke tests remain mandatory before exposure. Authorization is enforced at the HTTP boundary; internal service callers must continue to use AccessPolicy. There is no new RLS layer. Membership checks are per request, not serializable with concurrent family changes; in-flight authorized requests are not retroactively revoked. Rate limiting, credential/session expiry UX and security telemetry should be reviewed before public exposure. SHA verifier compromise alone does not reveal tokens; full application-host compromise remains outside encryption protection.

Phase B idempotency/atomic batches are locally implemented and validated. Phase C (Eden reads) is implemented locally; Phases D (confirmed mutations) and E (destructive confirmations) remain unimplemented. Eden must continue using deterministic out-of-band pending-action confirmation for future writes; the model must never receive credentials or trusted identity claims.

## Results for this implementation

30 mocked HTTP/security tests, 10 real PostgreSQL 17.6 tests and 2 Chromium media workflow tests passed. Backend/frontend TypeScript checks and builds passed. The PostgreSQL suite loads all 10 entity metadata definitions and validates populated legacy records, constraints, rollback/reapplication, Auth lifecycle column privileges and real repository policies. Docker remained unavailable; a fresh standalone temporary PostgreSQL cluster was used instead. Git whitespace checks passed. Vite emitted a non-failing bundle-size warning; no lint command is configured. Dependencies were temporarily read through a local symlink to the existing installation during checks; that link was removed afterward. Install dependencies in this worktree before rerunning checks. No production credentials were copied.

See [the final validation report](PHASE_A_VALIDATION.md) for fixes, remaining deployment gates and reproduction details.

## Changed files

- `PROJECT_CONTEXT.md`
- `README.md`
- `backend/.env.example`
- `backend/package.json`
- `backend/src/app.module.ts`
- `backend/src/database/data-source.ts`
- `backend/src/database/entities.ts`
- `backend/src/database/entities/hidden-product.entity.ts`
- `backend/src/database/entities/integration-credential.entity.ts`
- `backend/src/database/migrations/1794096000000-eden-security.ts`
- `backend/src/modules/auth/access-policy.service.ts`
- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/auth/auth.module.ts`
- `backend/src/modules/auth/integration-credentials.controller.ts`
- `backend/src/modules/auth/integration-credentials.service.ts`
- `backend/src/modules/auth/privacy.interceptor.ts`
- `backend/src/modules/auth/supabase-auth.guard.ts`
- `backend/src/modules/families/families.controller.ts`
- `backend/src/modules/list-items/list-items.controller.ts`
- `backend/src/modules/list-items/list-items.service.ts`
- `backend/src/modules/lists/lists.controller.ts`
- `backend/src/modules/products/products.controller.ts`
- `backend/src/modules/products/products.module.ts`
- `backend/src/modules/products/products.service.ts`
- `backend/src/modules/sessions/sessions.controller.ts`
- `backend/src/modules/sessions/sessions.service.ts`
- `backend/src/modules/uploads/uploads.controller.ts`
- `backend/src/modules/uploads/uploads.module.ts`
- `backend/src/modules/uploads/uploads.service.ts`
- `backend/test/fixtures/legacy-schema.sql`
- `backend/test/migrations.cjs`
- `backend/test/security.test.cjs`
- `docs/EDEN_INTEGRATION_SECURITY.md`
- `docs/PHASE_A_VALIDATION.md`
- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/components/ProductImage.tsx`
- `frontend/src/pages/CategoriesPage.tsx`
- `frontend/src/pages/EdenConnectionPage.tsx`
- `frontend/src/pages/ListDetailPage.tsx`
- `frontend/src/pages/ProductsPage.tsx`
- `frontend/src/pages/ShoppingModePage.tsx`
- `frontend/src/types/index.ts`
- `frontend/test/media-browser.cjs`

## Phase D update (2026-11-09; committed locally, disabled)

Phase C commits were verified without duplicate commits. Confirmed Eden create/add/quantity/unit/purchased/unpurchased/rename operations are now implemented. The server advertises `mutationProtocol: "phase-d-v1"` and enforces optional `If-Match` list fingerprints transactionally; old servers cannot enable Eden writes. Read-only remains the default, and write credentials require fresh explicit host opt-in. [Phase D protocol, validation and remaining gates](PHASE_D.md). No schema migration, deletion/removal tool, deployment or account activation is included.
