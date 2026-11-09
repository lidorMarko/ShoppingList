# Phase D — confirmed Eden shopping mutations

Status (2026-11-09): implemented, validated and committed locally with explicit approval on 2026-11-09, disabled, not deployed or connected to an account. Local Phase D commits approved on 2026-11-09. No push, merge, backup or production access was performed.

Phase C was already committed on the expected clean branches: Eden `825e801761ac17abc6faa838972bed78dd3c08f8`; ShoppingList `ac225908445133494d76ff1ce3313497b8ce7ad8`. No duplicate commits were created.

Eden now proposes create-list, atomic single/multi-product add/merge, absolute quantity/unit updates, explicit purchased/unpurchased state and rename. It reuses durable Telegram confirmations and sends at most one write with its pending-action UUID as Idempotency-Key. All external writes occur after deterministic confirmation; uncertain results/restarts consult the operation ledger without resending. No deletion/removal or destructive bulk operation is exposed by Eden.

## Protocol additions

- `GET /api/integrations/eden/self` adds non-secret `mutationProtocol: "phase-d-v1"`. Eden refuses writes when this marker is absent, including against older servers that would ignore a precondition header. Read-only connection compatibility is unchanged.
- Optional `If-Match: <64 lowercase hexadecimal SHA-256>` on list rename, item batch, quantity/unit update and explicit purchase state binds a list snapshot. It is checked after authorization under the existing parent-list transaction lock, before any write. A mismatch returns 409, no mutation and no receipt. Invalid fingerprints return 400.
- The request hash includes the precondition when supplied. An authorized matching committed receipt is returned before checking the current state, so successful replay remains valid after the original mutation changes that state. Reusing its key with a different fingerprint returns 409.
- Existing web/keyed clients without the header keep Phase B behavior. No database schema migration is required.

The fingerprint is SHA-256 of JSON.stringify over `[list.id, normalizedName, sortedItems]`. Items sort by lowercase UUID and each is `[item.id, item.productId, quantityNumberOrNull, normalizedUnitOrNull, normalizedNotesOrNull, isPurchased]`. Text is NFC-normalized and trimmed, empty becomes null. Decimal database strings become finite numbers. Eden computes the same fingerprint from the validated current list. Product display names are not part of the list-state lock contract; catalog administration remains independent.

## Consent and security

Default scopes remain read-only. Write authorization requires the existing unchecked ShoppingList opt-in plus a fresh host connection with explicit `npm run shopping:connect -- --allow-write`. Existing read connections are never upgraded. The encrypted envelope authenticates scopes and preserves old Phase C ciphertext. Every write and ledger lookup verifies current credential expiry/revocation/scopes and current account/household/resource access. The UI explains that server write grants include deletion although Eden exposes no deletion tools.

Deploy the matched backend before any separately authorized Phase D use. Phase A database/private-storage/role/TLS gates remain. No real connection or deployment has been attempted.

## Validation

- Eden full suite: 639 passed, including Calendar and Memory regressions; typecheck and build pass.
- ShoppingList backend HTTP/security: 32 passed.
- Real HTTP/PostgreSQL operations: 32 passed (27 existing plus 5 Phase D conditional-write tests).
- Real security/migration tests: 10 passed; operation migration/rollback tests: 5 passed.
- Chromium authenticated media and write-consent regressions: 3 passed.
- Backend and frontend typechecks/builds and whitespace checks pass. Existing non-failing Vite bundle-size warning remains.

All database tests used fresh disposable databases in a dedicated loopback PostgreSQL 18.4 cluster. Browser tests used synthetic configuration and a loopback mock API. No production API/database, Supabase account or OpenAI service was used. Live Telegram/account verification remains outstanding.

## Files changed in ShoppingList

- `backend/src/modules/auth/integration-credentials.service.ts`
- `backend/src/modules/lists/lists.controller.ts`
- `backend/src/modules/list-items/list-items.controller.ts`
- `backend/src/modules/operations/reliable-shopping.service.ts`
- `backend/test/security.test.cjs`
- `backend/test/operations-postgres.cjs`
- `frontend/src/pages/EdenConnectionPage.tsx`
- `PROJECT_CONTEXT.md`, `README.md`, `docs/EDEN_INTEGRATION_SECURITY.md`, `docs/PHASE_D.md`

Full Eden implementation inventory and remaining limits: `../eden-shopping-integration/docs/ShoppingList-Phase-D.md`.
