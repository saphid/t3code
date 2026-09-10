# Authenticated read authority for extension API invocation

Status: implemented and verified bounded prerequisite; see [read API authority evidence](read-api-authority-evidence.md). This does not add an Agents API or change package/SDK request schemas.

## Decision and boundary

`extensions.invokeApi` already carries the installed package identity, content hash, API request, and host-owned scope. The missing seam is only authenticated transport authority: At the recorded baseline, HTTP required `access:write` for every API invocation, while the broker already distinguishes read and write method effects and propagates a root `allowWrite` ceiling.

Keep the endpoint and request/response unchanged. Select the root authority from the authenticated `EnvironmentAuthenticatedPrincipal`:

- If the verified session has `access:write`, require that scope and construct `makeSessionApiAuthority(..., AuthAccessWriteScope, ...)`; this preserves existing write-only callers and gives `allowWrite: true` even when the session also has `orchestration:read`.
- Otherwise require `orchestration:read` and construct `makeSessionApiAuthority(..., AuthOrchestrationReadScope, ...)`; this produces `allowWrite: false` and admits declared read methods.
- If neither scope exists, fail through the existing `EnvironmentScopeRequiredError` path. Do not require read in addition to the old write scope.

The scope choice is made from the host-verified principal, never from API input, declared effect supplied by a caller, plugin identity, grants, or a root flag. No endpoint, SDK flag, provider grant, or API registration behavior changes.

## Verified enforcement path

`apps/server/src/auth/http.ts:191-198` returns the host-provided principal and checks its persisted scope set. `apps/server/src/extensions/sessionApiAuthority.ts:21-70` captures immutable non-secret principal identity, requires the selected scope at creation and on revalidation, and sets `allowWrite` only for `access:write`. `apps/server/src/extensions/http.ts:36-42` is the sole change point.

`packages/extension-runtime/src/broker.ts:259-292` validates and freezes root identity/environment; `:317-325` captures the root before asynchronous work; `:360-389` revalidates, checks scope, resolves the provider, and rejects `method.effect === "write"` when `authority.allowWrite` is false. `:400-418` rechecks caller grants/scope/provider generation before dispatch, and `:452-454` rechecks before output delivery. Nested calls receive `allowWrite: authority.allowWrite && method.effect === "write"` (`:421-433`), so a read-only root cannot regain write authority through a provider. Existing provider grants and caller/provider generation checks remain untouched.

## Focused proof cases

Extend the existing HTTP operation fixture to prove the four principal scope shapes: read-only routes the existing mocked `EnvironmentExtensions.invokeApi` operation and receives `allowWrite: false`; write-only still routes and receives `allowWrite: true`; both scopes select write authority and preserve `allowWrite: true`; neither scope is denied before `EnvironmentExtensions.invokeApi` runs. This fixture proves transport scope selection and root construction, not execution of a real declared method. Broker/root tests and the independently installed Files proof cover actual handler and nested-write enforcement. Keep existing read-only discovery/list/client and write-only denial assertions.

Add or extend focused broker/root tests only if the current verified suite does not already cover the read-root ceiling: read root plus installed write grant must reject the write method before its handler; a nested provider call must retain `allowWrite: false`; revalidation failure before dispatch and after an awaited result must deny/suppress delivery. Do not duplicate already-proven broker cases without a concrete gap.

Update the existing authority documentation and SDK authoring guidance to say that authenticated API invocation accepts `orchestration:read` for read-effect methods, while `access:write` remains required for write-effect methods. This is host authority, not a plugin grant and not process sandboxing.

## Verification and handoff

Run only the touched server/auth/broker tests, scoped lint/typecheck if needed, under the exact shared lock `/home/saphid/artifacts/t3-extensions-20260909/heavy-check.lock`. Capture raw logs and real exit JSON, then hash the exact changed source/docs. Parent owns installed Files proof, production build, integration and final commit. Full Agents work remains out of scope.
