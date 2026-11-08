# Phase B — reliable ShoppingList mutations

Status (2026-11-08): implemented and locally validated; local-only, disabled and not deployed. Phase A parent: 019bda4e5f489f0172debc8896c23253a8d4e270. No Eden tools, Telegram flows, production access or database synchronization were added.

## Endpoints

| Method/path (under /api) | Behavior |
|---|---|
| POST /lists | Create a list; optional web / required integration idempotency key |
| PUT /lists/:id | Rename with the same reliability contract |
| DELETE /lists/:id | Delete with the same reliability contract |
| POST /lists/:id/copy-items | Atomic copy; retains existing skip-existing-product semantics |
| POST /lists/:listId/items | Existing single-add behavior, now transactional/idempotent when keyed |
| PUT /lists/:listId/items/:itemId | Update quantity/unit/notes/product/explicit purchase state |
| PATCH /lists/:listId/items/:itemId/purchased | Set strict boolean isPurchased=true or false |
| DELETE /lists/:listId/items/:itemId | Remove item |
| POST /lists/:listId/items/batch | Add/merge 1–50 products atomically; key required for everyone |
| PATCH /lists/:listId/items/:itemId/toggle | Legacy web-only behavior; integration credentials are denied |
| GET /integration/operations/:operationId | Current principal's committed operation receipt |
| GET /integration/operations/by-key | Same lookup using the Idempotency-Key header after a lost response |

DELETE and legacy toggle have no body fields; unsupported bodies are rejected rather than ignored.

Catalog/product creation, categories, uploads/receipts, sessions, family management and credential-management writes are outside this idempotency contract. No automatic mutation retries were added anywhere.

## Durable idempotency and recovery

Idempotency-Key accepts 16–128 case-sensitive ASCII letters/digits or . _ : -. Use a fresh random UUID for each new intent, and retain it until the outcome is reconciled. Keys are scoped to the verified ShoppingList user, not to an individual credential/session, so a newly consented replacement credential for the same account can recover a prior operation. A unique (userId,keyHash) index enforces the binding. Only SHA-256 hashes of the key and canonical request are stored; no credential or trusted identity claim comes from model/body fields.

The request hash binds operation, resource identifiers and validated normalized payload. Object key order is ignored; identifiers are lowercased and string fields are trimmed/NFC-normalized. Array order and selector representation remain part of the request (productName versus productId is different); callers must replay the original intent rather than change a key's meaning.

Each keyed request acquires a PostgreSQL transaction advisory lock for account/key before looking up its receipt. It revalidates the current credential/account/profile and resource access. A successful mutation and its original HTTP status/JSON result commit in the SAME transaction using only the transaction manager's repositories. Concurrent duplicate requests wait and return that committed receipt; changed payload or operation returns 409. There is no gap between an accepted write and durable receipt creation. Advisory hash collisions can only serialize unrelated work; the database's unique account/key constraint remains authoritative.

All reliable list/item mutations lock their affected parent list rows (sorted for multi-list operations), so independent keys cannot lose quantity updates. Relevant profile/product rows are locked and authorization is rechecked inside the transaction. Batch additions resolve authorized products, validate/plan all merges, then write using that transaction. Any invalid item or later database error rolls the entire operation back, including earlier updates/inserts and the new receipt. Lock waits are bounded to 5 seconds and SQL statements to 15 seconds. These are per-lock/per-statement limits, not an overall request deadline.

Successful keyed responses include X-Operation-Id and Idempotency-Replayed=true/false, exposed to the frontend through CORS. Responses/status remain no-store. Replay returns the original successful result, not the list's latest state. Current privacy filtering may redact a nested product that has since become inaccessible. Receipt access is NOT shared just because the caller shares a household: its owner must match the authenticated user. Current list ownership/family access is checked again. If a target has been removed, the trusted receipt's recorded owner is checked against current family membership; caller-supplied tombstones/identity claims are never accepted.

Status returns {operationId,status:succeeded,httpStatus,result}. Only committed successes are visible. A 404 means absent OR not yet committed, not proof of failure. Validation/authorization failures and aborted transactions do not consume a key or create a success receipt. After a timeout/network/unknown COMMIT outcome, query by ID or by key header; if unresolved, retry only the identical mutation WITH THE SAME KEY. Never change payload/key merely because the first response was lost. No automatic retry is performed by the server. Recoverable database failures return a fixed 503 without logging SQL parameters, tokens or sensitive payloads.

Legacy web writes without keys retain existing response shapes/statuses and transactional authorization, but have no durable replay guarantee. A lost unkeyed response requires checking resource state before resubmission. Existing single-add continues to allow duplicate rows for compatibility; the new batch behavior is deliberately stricter. Incoming single-item quantities now also reject excess precision/range, units over 32 characters and notes over 2000 characters; existing stored values are not converted.

Receipts have no automatic expiry/cleanup. They are part of the authoritative ShoppingList database, not a second shopping catalog or synchronization system. They survive service restarts and Phase B rollback/reapplication. Account/profile deletion cascades its receipts. Reprovisioning the same Auth identity after profile deletion ends the old-key guarantee; do not resume an unreconciled old request across that administrative lifecycle without checking its actual outcome. Any future retention policy must preserve consumed-key tombstones or define a new client contract before deleting records.

## Approved batch business rules

Each item specifies EXACTLY ONE existing productId or exact productName. Names are trimmed/NFC-normalized and case-sensitive; Hebrew is preserved. Only current authorized, non-hidden products participate. An unknown/inaccessible match returns 404; multiple visible exact matches return 409 and require an explicit productId. The endpoint never guesses a match, creates a catalog product or converts units.

Quantities are nonnegative finite numbers with at most two decimal places and max 99,999,999.99. A single new product may leave quantity unspecified. Duplicate merging requires explicit numeric quantities for every participating item. Arithmetic sums integer hundredths to avoid floating-point accumulation. Overflow returns 409.

Matching units means exact trimmed/NFC text, including case; no aliases or conversions. Missing units match only other missing units. Notes (after trimming/NFC; empty means none) and purchased states must also match. Omitted purchase state means false; explicitly supplied state must be boolean. Compatible duplicates within the batch and one existing list row combine quantities. Different units/notes/states, unspecified duplicate quantities, or multiple existing rows for a product reject the ENTIRE batch with 409 and require explicit updates. No row is silently selected or cleaned up. Existing purchased items are not silently reset. Results are deterministic by resolved product ID and include one resulting row per product.

Example body: {"items":[{"productName":"חלב","quantity":2,"unit":"קרטון"},{"productName":"לחם","quantity":1,"unit":"יחידה"}]}. Product names must match visible catalog entries exactly; resolving an ambiguous name is a caller/user decision.

## Explicit write consent and authorization

The default remains shopping:read. A signed-in account may explicitly opt in to [shopping:read,shopping:write] via the unchecked consent checkbox. Existing read-only credentials are not upgraded. The UI explains that write access includes list/item deletion. Read grants cannot call mutations or operation-status recovery. Credential rotation requires fresh explicit scope consent; the old credential is revoked atomically. Current revocation/expiry/scopes and Supabase Auth deletion/ban are checked before recovery/replay as well as new mutations. Credential row locks serialize accepted transactions against revocation/rotation; already-authorized in-flight work is not retroactively cancelled.

Guard-level authorization stays fail-closed. Keyed mutation resource checks defer to the transaction service because a valid replay may target an already-deleted item/list. That service uses the SAME AccessPolicy with a transaction manager, validates resource IDs/DTOs at its boundary, and reauthorizes before writing or returning a receipt. Non-keyed legacy routes keep the guard's checks too. No unchecked callback can perform a write through the ledger. The integration still cannot manage credentials/families/media/catalog or use toggle operations.

Eden's existing standalone encryption helper remains read-scope-bound and unconnected. No host provisioning, transport, tool or Telegram execution was added in Phase B. Later phases must verify actual granted scopes, keep credentials outside model context, and require deterministic out-of-band confirmation before invoking any mutation (plus explicit destructive confirmation where required).

## Migration and rollback

1794096001000-shopping-operations requires the Phase A credential table. It adds shopping_operations with UUID primary key, profile FK/cascade, account/key uniqueness, hash/operation/status/binding checks and account/creation index; it extends the credential scope check to permit only read or read+write. Existing list/product/item/session/media records are preserved. The workspace migration CLI now uses TypeORM’s installed CommonJS/ts-node binary rather than a missing backend-local node_modules path. CLI apply/revert/reapply was also exercised on a fresh legacy-fixture database and preserved its existing Hebrew list record. App/CLI synchronize remains false; no automatic migration/seed runs on startup.

Down migration revokes and downgrades write-scoped credentials, restores the Phase A read-only constraint, and DELIBERATELY RETAINS the operation table/indexes/data. Dropping receipts would make old successful requests repeat after reapplication. Reapplication recognizes the ledger marker and verifies expected columns/primary key/uniqueness; unrecognized or damaged ledgers fail for manual inspection. This is a data-preserving rollback, not a physical removal of every Phase B object. Coordinate code/schema rollback and do not send new mutation requests to an older backend that lacks the idempotency contract. Fresh consent is required for write credentials after rollback.

## Validation

| Suite | Passed |
|---|---:|
| Phase A HTTP authentication/authorization/media regression | 30 |
| Phase A real PostgreSQL migration/repository regression | 10 |
| Phase B real PostgreSQL migration tests | 5 |
| Phase B real HTTP/PostgreSQL mutation/recovery tests | 27 |
| Chromium media + opt-in write-consent regressions | 3 |
| Eden envelope + existing secretBox tests | 10 |

Total: 85 tests passed. Backend/frontend/Eden TypeScript checks and builds passed. Whitespace checks passed; no lint command is configured. Vite emits its existing non-failing bundle-size warning. The full unrelated Eden DB-backed suite was not invoked because Eden runtime code is unchanged.

Real tests used a fresh native PostgreSQL 17.6 cluster, random loopback port and newly created empty disposable databases, with populated synthetic legacy schemas. Coverage includes replay/body conflicts, 20 concurrent duplicates, independent-key quantity races, late insert/update rollback, explicit purchase true/false, ambiguity/Hebrew/visibility, deletion replay, dropped HTTP response recovery, a new service instance, rotation, revoked/expired/downgraded/family-removed credentials, and privacy filtering on cached results. Expected failing migration cases are asserted tests, not production failures.

Reproduce after installing dependencies in this worktree: npm test --workspace=backend; run test:migrations, test:operation-migrations and test:operations with SHOPPINGLIST_TEST_DATABASE_URL pointing to a SEPARATE FRESH empty loopback shoppinglist_eden_test_* database for each suite. The harness refuses other hosts/names or populated databases and never loads DATABASE_URL/.env. For frontend tests use the synthetic build settings documented in PHASE_A_VALIDATION.md and test:media with an existing Playwright/Chromium installation. No production environment values are needed.

## Remaining risks and boundaries

Integration remains disabled and no real connection was authorized/provisioned. Production schema/role grants, private buckets and storage.objects policies, legacy public object exposure, TLS and release ordering remain Phase A deployment gates. The new migration must precede enabling write grants/reliable endpoints; frontend/backend changes must be coordinated. No production data/storage/API was accessed or modified.

Operation receipts retain potentially sensitive shopping result snapshots and grow until an approved retention design exists. They must inherit database access controls/log redaction and must not be bulk-exposed to the model. Late auth/product-visibility changes are rechecked on subsequent requests; auth-account bans or new hidden-catalog entries during an already-authorized in-flight transaction do not cancel that transaction. All writers for list/item operations must continue using the transaction service and parent locks; direct manual DB/catalog cascades are not made into idempotent API operations here.

No Phase C/D/E tools, confirmations or destructive Telegram flow is implemented. Local Phase B commits were explicitly approved. No pushes, merges, deployments, backups or original/Calendar/Memory checkout changes were performed. Phase C and deployment still require separate approval.

## Files changed

- `PROJECT_CONTEXT.md`
- `README.md`
- `backend/package.json`
- `backend/src/database/data-source.ts`
- `backend/src/database/entities.ts`
- `backend/src/database/entities/shopping-operation.entity.ts`
- `backend/src/database/migrations/1794096001000-shopping-operations.ts`
- `backend/src/main.ts`
- `backend/src/modules/auth/access-policy.service.ts`
- `backend/src/modules/auth/auth.module.ts`
- `backend/src/modules/auth/integration-credentials.service.ts`
- `backend/src/modules/auth/supabase-auth.guard.ts`
- `backend/src/modules/list-items/dto/batch-items.dto.ts`
- `backend/src/modules/list-items/dto/create-list-item.dto.ts`
- `backend/src/modules/list-items/list-items.controller.ts`
- `backend/src/modules/lists/lists.controller.ts`
- `backend/src/modules/operations/atomic-batch.service.ts`
- `backend/src/modules/operations/operation-types.ts`
- `backend/src/modules/operations/operations.controller.ts`
- `backend/src/modules/operations/reliable-shopping.service.ts`
- `backend/test/operations-migration.cjs`
- `backend/test/operations-postgres.cjs`
- `backend/test/postgres-fixture.cjs`
- `backend/test/security.test.cjs`
- `docs/EDEN_INTEGRATION_SECURITY.md`
- `docs/PHASE_B.md`
- `frontend/src/pages/EdenConnectionPage.tsx`
- `frontend/test/media-browser.cjs`

Temporary test databases, cluster, downloaded binaries/cache and the dependency symlink were removed after validation. No production database, storage, service or original checkout was modified.

## Eden documentation-only changes

- `README.md`
- `docs/Architecture.md`
- `docs/CHANGELOG.md`
- `docs/Roadmap.md`
- `docs/ShoppingList-Integration.md`
- `docs/Tasks.md`
- `docs/adr/0015-shopping-existing-account-credential-boundary.md`

Eden runtime, tools, encrypted credential helper and database schema are unchanged in Phase B.
