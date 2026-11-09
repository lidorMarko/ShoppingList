# Phase E — confirmed item removal and PIN-gated whole-list deletion

Status (2026-11-09): implemented, locally validated and committed locally with approval on 2026-11-09, disabled, not deployed or connected to an account. The approved durable PIN integration resolves the earlier whole-list blocker while preserving all uncommitted individual-removal work. Only local commits were explicitly approved after final review; no production access, push, merge, deployment or backup was performed.

## Server protocol

Both reliable item and list DELETE routes accept the existing optional `If-Match` full list-state fingerprint. Eden always supplies it with its durable pending-action UUID as Idempotency-Key. Under the parent-list transaction lock, the server revalidates current account/credential/write scopes/profile/household/resource authorization, checks the fingerprint and commits deletion plus its operation receipt together. A stale request deletes nothing and creates no receipt. Invalid snapshots and forged ownership bodies are rejected.

An authorized matching committed receipt is returned before checking current resource presence or state. This preserves exact 204 replay and ledger recovery after the list/item is gone. Current owner/household authorization is rechecked for receipt access; absent resources use the trusted recorded binding, never caller claims. Concurrent duplicate keys return one committed result; changed keys/payload/snapshot cannot repeat that intent as a replay.

`GET /api/integrations/eden/self` advertises `mutationProtocol: "phase-d-v1"`, `itemRemovalProtocol: "phase-e-item-v1"` and `listDeletionProtocol: "phase-e-list-v1"`. Eden requires the appropriate capability both at proposal and sending, preventing older servers from silently ignoring destructive preconditions. Empty 204 success carries the existing operation-ID header; an absent/malformed marker is reconciled rather than blindly trusted or retried. Existing legacy/web callers without the optional header retain Phase B behavior. No ShoppingList migration or new credential scope is required.

## Eden PIN and confirmation gate

Whole-list deletion now has a distinct `shopping.delete_list` policy requiring durable action-bound PIN step-up AND the original Telegram confirmation button. Its full Hebrew preview names the list, counts affected items and explicitly warns that the entire list and its items will be deleted. Individual removal retains its exact list/product/quantity/unit/purchase-state preview and original removal button.

Eden migration 0006 extends its existing step-up table with owner/identity/session/chat/original-message/action/canonical-hash/original-deadline bindings. Preview attachment and challenge creation are atomic. The challenge expires at the earliest action/session/configured step-up deadline. Only a Reply to the original preview can verify it through Auth Gateway, using existing Argon2/pepper/failure/lockout behavior. PIN input and late known/unbound PIN-like replies cannot enter model/history/log paths. No second PIN system or alternate confirmation path is introduced.

PIN verification alone changes only the grant. The original callback revalidates all bindings and atomically consumes the fresh grant with the action's pending→executing transition. Only one callback wins. Execution rechecks the stored plan, consumed proof, current authentication/connection/scopes/resources and snapshot. Final auth/proof/deadline checks and execution-start marking are atomic. Exactly one external DELETE may be sent; uncertain outcomes consult only the authorized operation ledger.

A verified pending grant survives restart until expiry. A callback-confirmed step-up action interrupted before sending fails closed and needs a new proposal/PIN. Any possibly sent operation is reconciled only; missing receipts remain unknown. Cancellation, supersession, altered payload/deadlines, session/identity changes and expired challenges cannot reuse proof. A fresh request after expiry creates a new action/challenge. Legacy tool-scoped approvals remain isolated.

## Validation

- Eden: 712 tests (85 suites) and 6 additive-migration checks passed, including a cold Node-process restart/PIN privacy test, concurrent lockout accounting, atomic confirmations, expiry/replacement and Calendar/Memory/read/write/removal regressions.
- ShoppingList backend security/HTTP: 32 passed.
- Real HTTP/PostgreSQL operations: 52 passed, including conditional whole-list deletion, stale name/item/count/quantity/purchase state, independent/duplicate concurrency, revoked/read-only/household access and dropped-response ledger recovery.
- Security/migration: 10 passed; operation migration/rollback: 5 passed; Chromium media/explicit consent: 3 passed.
- Typechecks/builds and whitespace checks passed in both worktrees. Existing non-failing Vite bundle-size warning remains.

All tests used mocks, synthetic credentials/configuration and fresh disposable loopback PostgreSQL 18.4 databases. The disposable test cluster was stopped and removed after validation. Browser tests used a loopback mock API. No production service, OpenAI API or real Supabase account was used. Integration remains disabled; live Telegram/account verification and Phase A exposure gates remain outstanding.

## Changed ShoppingList files

- `backend/src/modules/auth/integration-credentials.service.ts`
- `backend/src/modules/list-items/list-items.controller.ts`
- `backend/src/modules/lists/lists.controller.ts`
- `backend/src/modules/operations/reliable-shopping.service.ts`
- `backend/test/security.test.cjs`, `backend/test/operations-postgres.cjs`
- `frontend/src/pages/EdenConnectionPage.tsx`
- `PROJECT_CONTEXT.md`, `README.md`, `docs/EDEN_INTEGRATION_SECURITY.md`, `docs/PHASE_E.md`

Complete Eden architecture, migration, file inventory and recovery/rollback limits: `../eden-shopping-integration/docs/ShoppingList-Phase-E.md`.

Local Phase E commits were explicitly approved on 2026-11-09 after final review. Apply Eden migration 0006 before new gateway code and coordinate the matched server protocol before separately authorized use. Do not roll back to an older gateway that can route late PINs to conversation; stop Telegram intake before a coordinated rollback that removes those guards. Only local commits are included here; deployment and branch integration are not authorized.
