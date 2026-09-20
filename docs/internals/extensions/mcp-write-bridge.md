# MCP write bridge — assessment

Status: assessment only; no code. The t3-ui slice deferred "MCP write bridge" with three open questions — principal→authority propagation, target transport, and tool-invoke vs invokeApi. All three resolve to design decisions, not implementation gaps, so the work stops here pending sign-off.

## What exists today

MCP clients reach the server over HTTP at `/mcp`, outside the environment auth stack. A bearer token resolves through [McpSessionRegistry](../../../apps/server/src/mcp/McpSessionRegistry.ts) into an `McpInvocationScope` (environmentId, threadId, providerSessionId, providerInstanceId, capability set, issuedAt). Liveness is 24h from the last sign of life, refreshed by MCP traffic and by `touch` on each provider turn; `stopSession`/`revokeThread` revoke eagerly.

The extension toolkit ([extensions/mcp.ts](../../../apps/server/src/extensions/mcp.ts)) exposes exactly two tools, both annotated `Tool.Readonly`: `extensions_list` and `extensions_call`. `extensions_call` invokes an _extension-declared tool_ through `EnvironmentExtensions.invoke` → `runtime.invoke(toolId, …)`, with context derived from the credential (`contextForThread`, `client: "mcp"`) — caller-supplied context is never authority.

The read-only boundary is structural, not incidental. Three layers enforce it independently:

1. `ToolDescriptor.readOnly` is typed as the literal `true` and `validateEnvironmentPackage` throws on `readOnly !== true` ([environment.ts:223](../../../packages/extension-sdk/src/environment.ts)). Write tools are not representable in a package.
2. `EnvironmentExtensions.tools` only surfaces tools that are `readOnly` and whose every capability is `t3.workspace/read-text` and granted ([EnvironmentExtensions.ts](../../../apps/server/src/extensions/EnvironmentExtensions.ts)).
3. `extensions_call` re-verifies `toolId` + `expectedContentHash` against that filtered catalog before invoking.

Separately, `EnvironmentExtensions.invokeApi`/`subscribeApi` accept a `HostApiRootAuthority` — principal, `allowWrite`, `revalidate` — which the broker checks on every call and frame (`requiresRootAuthority` providers refuse rootless calls; `method.effect === "write"` requires `allowWrite`). The WS gateway builds that root from an `AuthenticatedSession` via [sessionApiAuthority.ts](../../../apps/server/src/extensions/sessionApiAuthority.ts): it captures sessionId/subject/scopes and revalidates against `SessionStore` before every call, so a revoked or scope-narrowed session dies mid-request.

## 1. Principal → authority propagation

The MCP credential is a _provider-session_ principal, not an environment session. `HostApiPrincipal.kind` already admits `"provider-session"`, so the type anticipates this; nothing mints one today.

A faithful MCP root authority would be:

- `principal: { kind: "provider-session", id: providerSessionId, environmentId, scopes: <derived> }`
- `revalidate`: re-check that the credential is still live — `McpSessionRegistry` can revoke by providerSessionId and prunes on liveness, but exposes no `isAlive(providerSessionId)` lookup; `resolve` is keyed by raw token hash and the toolkit handler holds only the resolved scope. A small registry addition would close this.

The blocker is `scopes`. Root-authority providers gate on _auth_ scopes (`principal.scopes.includes("orchestration:read")` and environmentId match — see [browserLocalServersApi.ts](../../../apps/server/src/extensions/browserLocalServersApi.ts)). MCP capabilities (`"preview" | "extensions" | "pull-requests"`) are not auth scopes. Two honest mappings exist, and choosing is a policy decision:

- **Derive auth scopes from capabilities** — e.g. `extensions` ⇒ `orchestration:read`. Simple, but it silently upgrades a per-thread agent credential to session-level read authority across the environment.
- **Recognize provider-session principals in providers** — providers check `kind === "provider-session"` and gate on `providerInstanceId`/capability instead of auth scopes. More precise, but it touches every `requiresRootAuthority` provider's guard.

Either way `allowWrite` needs its own answer: which MCP capability (new `"extensions:write"`? a `McpCredentialRequest` flag?) entitles a credential to drive writes, and whether issuance is interactive.

## 2. Target transport

`/mcp` is the only agent-facing transport. The WS `invokeApi`/`subscribeApi` path is bound to an authenticated UI session and cannot be reused without a parallel authority constructor — so the realistic target is the existing toolkit: either widening `extensions_call` to admit non-readOnly tools, or a separate `extensions_write`/`extensions_subscribe` tool pair so the read catalog stays small and the write surface is independently annotatable (`Tool.Destructive`).

Streams over MCP are a further decision: the tool-call model is unary, so `subscribeApi`-style delivery would need either a new notification channel or a poll-with-cursor tool. The t3-ui ask (driving a write) does not require streams.

## 3. Tool-invoke vs invokeApi

Assessment: **tool-invoke is the coherent write unit; direct invokeApi bridging is a different feature.**

- Extension tools are the declared, granted, content-hash-pinned unit of work: `extensions_call` already pins `expectedContentHash`, `tools()` already intersects tool capabilities with installation grants, and the invocation runs the extension's own server entry — its writes are the plugin's declared behavior.
- `invokeApi` proxies _host-owned_ providers. Exposing it to MCP makes the credential a generic RPC stub into every public API, including providers whose guards assume an environment-session principal. The value would be letting an agent drive host APIs _without_ a plugin shipping a tool — a broader "agent API surface" feature that deserves its own contract (which API ids are agent-callable, which methods, at what effect).
- `runtime.invoke` takes no root authority today; write tools would need the same `assertAuthority`/revalidation discipline the broker applies to API calls, which is a runtime change, not a ws.ts shim.

## Decisions needed before code

1. Whether agent-held write authority exists at all — today it is deliberately impossible.
2. The principal mapping in §1 (scope derivation vs provider-session-aware guards).
3. The write entitlement: new MCP capability vs credential-request flag, and how `allowWrite` is derived.
4. Whether `ToolDescriptor` gains `readOnly: false` (and likely a `destructive` annotation), or a separate `WriteToolDescriptor`.
5. Which write _capabilities_ are grantable to tools — `tools()` currently whitelists exactly one capability id.
6. Root-authority propagation into `runtime.invoke`, or an explicit decision that tool writes re-validate through `EnvironmentExtensions` only.

Items 1–3 are product/security policy; 4–6 are contract work. Implementation should not start until 1–3 are answered, since they determine the shape of 4–6.
