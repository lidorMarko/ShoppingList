# Phase C — credential self-inspection for read-only Eden access

Status (2026-11-08): implemented and validated locally; not committed, deployed or enabled. Phase B parent: e020963fa12b9a10164a645b778470e049661f69. The Eden side (host connect/status/disconnect, encrypted storage, REST adapter, read-only tools) lives in the Eden repository: see its `docs/ShoppingList-Integration.md`.

## Endpoints (under /api)

| Method/path | Behavior |
|---|---|
| GET /integrations/eden/self | Returns `{credentialId, userId, scopes, expiresAt}` for the presenting integration credential only. No token or verifier hash. |
| DELETE /integrations/eden/self | Revokes the presenting credential only. Returns `{revoked: true}`. |

- Identity comes only from the verified bearer credential. The routes take no identifier, so they cannot describe or revoke another credential.
- Normal credential verification applies first: `EDEN_INTEGRATION_ENABLED`, format, timing-safe verifier, expiry, revocation, Auth deletion/ban and profile.
- Web sessions get 403. They keep using `/integrations/eden/credentials`. Unauthenticated requests get 401.
- Any valid credential may inspect or revoke itself, whatever its scopes. Self routes grant no shopping access.
- Responses are `no-store`.
- `AccessPolicy`'s closed manifest lists the new handlers (`IntegrationSelfController.inspect/revoke`). Existing read/write integration route rules are unchanged.

Purpose: Eden binds its encrypted copy of the credential to the account, scope and expiry that ShoppingList itself reports, instead of operator-typed claims. Eden refuses read+write credentials in Phase C and revokes the credential remotely on disconnect. This extends the Phase A consent credential; it is not a new authentication protocol.

The consent-page copy now points to Eden's `npm run shopping:connect` hidden-input step and states that Eden currently accepts read-only credentials. No migration or schema change.

## Validation

- `npm test --workspace=backend`: 32/32 pass (30 existing plus 2 new). The new tests cover self-inspection metadata and the absence of secrets; web-session denial; that no other credential is affected; self-revocation; rejection after revocation or expiry; integration disabled (404); and Auth-disabled accounts (401 without revoking).
- Backend `tsc` and build, and frontend `tsc` and build (synthetic env), pass. Vite keeps its existing bundle-size warning.
- The Phase A/B real-PostgreSQL and Chromium suites were not re-run: no schema, repository or media behavior changed.
- Dependencies were installed in this worktree with `npm ci --ignore-scripts` (gitignored `node_modules`).
- No production API, database or storage was accessed.

## Files changed

- `backend/src/modules/auth/integration-self.controller.ts` (new)
- `backend/src/modules/auth/integration-credentials.service.ts`
- `backend/src/modules/auth/access-policy.service.ts`
- `backend/src/modules/auth/auth.module.ts`
- `backend/test/security.test.cjs`
- `frontend/src/pages/EdenConnectionPage.tsx`
- `docs/EDEN_INTEGRATION_SECURITY.md`
- `docs/PHASE_C.md`
