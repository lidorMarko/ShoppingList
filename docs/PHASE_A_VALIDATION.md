# Phase A final security and migration validation

Date: 2026-11-08. Result: ready for review and local commits; no commits created. Integration remains disabled and unconnected. No Phase B work was started. No production service, data, storage object or original checkout was accessed or modified by validation.

## Results

| Suite | Passed | Environment |
|---|---:|---|
| ShoppingList authentication/authorization/media | 30 | Real Nest controllers/global guard, loopback Auth mock and repository/storage fixtures |
| PostgreSQL migrations and repository policies | 10 | Fresh disposable PostgreSQL 17.6, populated synthetic legacy schema |
| Frontend media regressions | 2 | Chromium with built frontend, synthetic session and loopback mock API |
| Eden credential encryption + existing secretBox | 10 | Pure crypto tests, no database/network |

Total: 52 tests passed. Backend/frontend/Eden TypeScript checks and builds passed. Git whitespace checks passed. No lint command is configured. Vite reports a non-failing bundle-size warning. The full existing Eden DB-backed suite was not invoked; its runtime was not changed.

## PostgreSQL validation

Docker was unavailable. Pinned standalone PostgreSQL 17.6 binaries (@embedded-postgres/darwin-arm64 17.6.0-beta.15 package) ran a newly initialized SCRAM-authenticated cluster in temporary storage, bound only to loopback on a random port. This was a real native PostgreSQL server, not a SQL emulator. Two independent freshly created test databases were used for initial/final runs; no application database was reused. The test cluster was stopped and removed after validation.

The fixture in backend/test/fixtures/legacy-schema.sql models the existing entities, columns, nullable ownership, relationships/cascades, catalog uniqueness and legacy indexes. It includes two households, three accounts, Hebrew product/list names and notes, global/private products, hidden preferences, lists/items, sessions, receipts and purchase history. All data is synthetic; no schema/data export or backup was created.

Tests verify existing rows, columns, defaults and indexes survive migration; expected credential/hide indexes and constraints exist; verifier format, read-only scopes, expiry, null/unknown owners and duplicate hides are enforced; profile deletion cascades credentials; rollback preserves legacy data/hide preferences; reapplication succeeds; already-applied migration is a no-op. Missing hidden_products is created additively. Duplicate legacy rows, conflicting index names and missing base tables fail without silently altering legacy records.

Application and CLI synchronize settings remain false; tests use explicit fixture DDL and runMigrations/undoLastMigration, never schema synchronization. The fixture represents the checked-in model; it does not establish the exact deployed schema. Deployment still needs its own approved prerequisite inspection. Rollback intentionally retains hidden_products even when first created by the migration.

## Authentication and authorization review

Tests deny unauthenticated requests across every declared protected handler, invalid/expired/revoked/insufficient-scope credentials, unrelated households, mismatched item parents, inaccessible products, forged ownership/admin fields and revoked household membership. Shared-family access remains functional. Current Supabase account ban/deletion blocks integration credentials even if a profile remains.

Routine getUser requests are tested with a publishable key; the Auth mock rejects any other API key, including the service-role sentinel. A PostgreSQL role with only schema usage plus SELECT(id,deleted_at,banned_until) on the synthetic auth.users table can run the lifecycle check. It cannot read email/encrypted_password or update Auth users. Missing grants fail closed. No production privileges were inspected or granted.

## Media review and fixes

Authorized owners/family members retrieve image and receipt bytes; outsiders cannot. Multipart upload tests verify the image owner derives from authentication and receipt access derives from the authorized parent session. Actual storage-service tests reject public buckets before fetching bytes and handle new private/legacy receipt references without arbitrary URL fetches.

Chromium verifies product image display, existing edit preview, upload/save, receipt image/lightbox, replacement with a valid synthetic PDF, PDF MIME/blob bytes and popup opening. Requests use bearer headers and loopback API endpoints; external requests are blocked. These tests validate application flows against mocks, not deployed Supabase storage/RLS or the PDF viewer's internal rendering implementation.

Fixes made during review:

- Admin writes and admin UI capabilities now require confirmed Auth email, not merely matching email text.
- Hidden-product images remain available only when referenced by a currently authorized list/session; catalog hiding is preserved.
- Nullable category clearing remains accepted while forged ownership fields remain rejected.
- Storage URLs with embedded userinfo or malformed percent encoding return controlled errors.
- Expanded real PostgreSQL and successful media/browser coverage; corrected mock sync behavior and native-PDF test assumptions.

## Remaining deployment gates and compatibility

Existing API shapes remain compatible where safe. Categories are global and admin-only for writes; global-product edits are similarly restricted. Deployment requires the new backend publishable/anon Auth key (a service-role-only configuration will fail closed), narrow Auth read grants, migration before updated backend startup, coordinated frontend/backend release, preconfigured private buckets, TLS/CA settings and explicitly supplied migration configuration. A legacy shared JWT secret is no longer required for routine authentication. No automatic seeding or synchronization occurs on startup.

Bucket public=false is necessary but not sufficient: permissive storage.objects RLS policies can still expose private objects through direct Storage requests. Actual deployed storage policies were intentionally not inspected. Before exposure, review anonymous/authenticated direct-object access policies, legacy object formats and public-bucket conversion in an approved environment. Existing public URLs/copies are a separate deployment confidentiality risk; this review did not access, move or delete them. Do not enable integration until those gates pass.

The application DB role needs the documented narrow Auth lifecycle read grants. Existing production data may contain duplicate hides, a different schema or colliding indexes; migration preflight fails rather than discarding data. Rate limiting/logging/reverse-proxy configuration and in-flight request versus concurrent membership/revocation semantics remain deployment review items. Revocation applies to new requests, not cancellation of an already-authorized read. Future internal service callers must use the shared policy; no new RLS layer was added to application tables.

No commit, push, merge, deployment, backup or Phase B implementation occurred. Original ShoppingList and Calendar/Memory worktree/index/source fingerprints were checked separately for isolation.

## Reproduction

Install dependencies in the isolated worktree. npm test --workspace=backend runs the HTTP suite. For PostgreSQL, create a fresh empty loopback database named shoppinglist_eden_test_* and explicitly supply SHOPPINGLIST_TEST_DATABASE_URL to npm run test:migrations --workspace=backend; the harness refuses an existing populated database or other host/name and never reads DATABASE_URL/.env.

For browser tests, build frontend with synthetic VITE_SUPABASE_URL=https://mock-project.example.test, a nonsecret synthetic VITE_SUPABASE_ANON_KEY and VITE_API_URL=/api. Run npm run test:media --workspace=frontend with SHOPPINGLIST_PLAYWRIGHT_MODULE pointing to an existing Playwright installation and Chromium available. No Playwright dependency was added to the shipping application. Test all real deployments separately before exposure.
