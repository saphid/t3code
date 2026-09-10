# Authenticated authority prerequisite

Status: the first three additions are implemented and verified below; the fourth is also implemented and verified. Each addition freezes host-only changes before implementation and does not advertise a callable plugin resource API.

## Why this precedes resources

Before these additions, the broker bound plugin identity, grants, ancestry and provider generation but had no authenticated root session. WebSocket authorization captures the session at upgrade; SessionStore revocation emits a change but does not close that socket. Resource leases must not rely on plugin-supplied context.client, resource IDs or JSON identities. Effect RPC allocates RpcClientId on the server per transport; that ID is process-local bookkeeping, not an authenticated principal.

## First bounded addition

Add SessionStore.revalidate(sessionId) as a host-internal service method. It accepts an ID already obtained from authentication; it is not a new network endpoint or replacement for token authentication. Return a non-secret RevalidatedSession with sessionId, subject, method, scopes and expiresAt loaded from the persisted row. Do not return token, client metadata, connected bookkeeping or proofKeyThumbprint: the latter is signed-token state not stored in AuthSessionRecord.

Reject unknown, revoked and expired rows, including expired connected sessions, with the existing typed credential errors. Wrap persistence failure as SessionCredentialVerificationError and preserve its cause. Use Effect DateTime.now. Existing listActive connected-session display semantics and ordinary app RPC behavior remain unchanged in this first slice. No global auth rewrite or schema migration.

The next authority adapter intersects persisted scopes with the originally authenticated scopes and preserves the verified root identity and proof binding. Revalidation never widens an existing caller's authority. Session validity is a point-in-time check, not a transaction spanning an external side effect.

Tests use the existing in-memory SessionStore fixture and TestClock: exact non-secret output, unknown/revoked/expired, connected expired rejection despite listActive display retention, persisted replacement revoke, database failure, and no returned proof/token. No sleeps.

## Subsequent host authority boundary

Introduce a host-only immutable root invocation authority, propagated through broker ApiAuthority into HostApiInvocationMetadata and audit identity. Its root kind distinguishes authenticated environment sessions, authenticated MCP provider sessions, and explicitly host-owned operations. Caller JSON cannot construct this value and worker IPC must inherit the parent's captured authority rather than deserialize a replacement.

Environment session roots require current session revalidation at admission, before domain dispatch, and before result/frame delivery. Bind active work to revocation and expiry cancellation. Subscribe to change notifications before the initial revalidation so no revoke can fall between checking and watching. Test both race orderings; a revoke committed before admission must deny, while already-dispatched external operations follow their documented cancellation semantics. Pending streams must terminate even when a producer emits nothing. Disconnect releases connection-bound attachments, not durable resources.

MCP roots are authenticated by McpSessionRegistry and carry providerSessionId/thread/provider-instance capabilities; they are not SessionStore AuthSessionIds. Their own registry lifetime and revocation must be used. The existing map at apps/server/src/mcp/McpInvocationContext.ts and McpSessionRegistry.ts is authoritative. Do not fake an environment session for MCP.

## Gates before Terminal and Browser

Prove a read-only host API sees immutable root identity through an independent consumer; prove nested writes cannot exceed the root authority. Prove revoked/expired sessions, stale provider generations, disconnected workers and late responses lose access, including active WebSocket streams. Then add durable resource references and transient attachment leases with owner/provider epochs, followed by native assets/engine adapters.

This plan leaves full panel replacement, orchestration V1/V2 adapters, remote/relay/tunnel behavior and React Native/SwiftUI renderer support unproven. Public streaming and read-only installed Files evidence do not satisfy those gates.

## Second bounded addition: existing extension stream admission

Before introducing native operations, guard the existing subscribeExtensionApi WebSocket
handler with the authenticated environment session. This internal adapter subscribes to
SessionStore changes before its first revalidation, checks original and persisted read scope,
subject/method identity and expiry, then revalidates before each delivered frame. A matching
session removal or the earlier of original/stored expiry interrupts even a silent pending
producer. Closing the RPC stream releases the watcher and producer; another session's
revocation has no effect. Failure is an ExtensionOperationError, without leaking credential
contents. Use Effect's clock and scoped stream acquisition, not timer polling.

This guard is deliberately limited to extension stream transport and does not claim full
root-principal metadata propagation, per-domain authorization, MCP lifetime or global
WebSocket revocation. Admission subscribes first, then reads persisted state; tests revoke
inside the revalidation boundary to prove the watcher cannot miss that race.

### Acquired watch correction

Effect Stream.toPull does not necessarily acquire the underlying subscription: Channel.unwrap
defers it until the first pull. The admission-race test exposed a missed removal. Add the
host-internal SessionStore.watchChanges() returning a scoped Effect of a stream, acquiring
PubSub.subscribe before returning Stream.fromSubscription. The guard awaits that acquisition,
then revalidates. Existing streamChanges remains compatible. Tests publish a removal inside
the revalidation callback, after watch acquisition but before producer consumption.

## Verified first two additions (2026-09-10)

SessionStore revalidation and acquired watching are implemented. The existing extension
WebSocket stream handler now rejects revoked or expired session admission, checks persisted
rights before frame delivery, and interrupts silent pending streams on revocation or expiry.
It does not close the entire WebSocket or change unrelated RPC authorization.

Focused verification: SessionStore 23/23; stream guard 8/8; scoped lint and server typecheck
passed; v10 production build passed. A raw-WebSocket installed-package proof used a separate
read-only login and the same provider/consumer packages. On the v9 baseline, a revoked socket
continued receiving a later counter increment. On v10, the silent stream failed after
revocation, a new subscription on that still-open socket failed, and another authenticated
session continued receiving increments. This proves server enforcement independently of UI
logout behavior. Expiry is proven with TestClock, not yet a timed network expiry run.

Evidence on lxso2: /home/saphid/artifacts/t3-extensions-health-rounds-20260909, especially
session-authority-evidence.json and proof/auth-session-{baseline,candidate}.json. The original
missed-watch race failures are retained. No provider-independent Claude review ran: the direct
Opus 5 high launcher failed authentication (OAuth expired, process exit 1, modelUsage empty).
Luna independently inspected the bounded implementation and proof script without actionable
findings after corrections. Full root metadata propagation, MCP revocation and native resource
APIs remain the next gates.

## Third bounded addition: host-only root authority through the broker

Freeze these internal runtime types before implementation. They do not change SDK package
format 3 or the wire request schemas.

HostApiPrincipal contains kind ("environment-session", "provider-session", or "host"), id,
environmentId, optional subject, and readonly scopes. It contains no credential or proof key.
HostApiRootAuthority contains that principal, allowWrite, and a host-owned revalidate callback
returning void or Promise<void>. The host constructs it after authentication. The runtime
captures and freezes the principal and scopes on entry; plugin JSON and IPC never construct
or replace it. Reject an authority whose environment differs from the validated resource.

Runtime invokeApi and subscribeApi gain an optional final root-authority argument for
embedding compatibility. ApiAuthority retains this root through every nested unary or stream
call and worker pending record. Initial allowWrite is intersected with the root's allowWrite;
streams and tool-originated calls remain read-only. Revalidate at admission and immediately
before dispatch and before results/frames escape. Callback failures deny the operation and
cannot be suppressed by a nested provider. Existing AbortSignal controls pending cancellation;
the root's host adapter owns its revocation watcher and expiry interruption.

HostApiInvocationMetadata and ApiAudit gain an optional sanitized principal snapshot.
HostApiProvider gains requiresRootAuthority?: boolean; providers opting in deny rootless calls
before invoking handlers. Omission preserves existing embeddings, not an authenticated
identity. Native resource providers must opt in. Registration does not construct a root or
grant capability access; existing plugin dependency/grant/provider checks stay intact.

This first runtime step covers invokeApi/subscribeApi and their nested descendants. Legacy
tool entrypoints and MCP root acquisition are separate adapter work, explicitly unproven until
wired and tested. Do not fabricate a root for legacy callers. Worker IPC must not include the
root object or callback; recover them only from host-owned parent pending state.

Tests: immutable identity despite caller object mutation; forged request/worker fields cannot
replace the root; nested independent worker calls preserve root metadata; read-only root cannot
write even with plugin grants; rootless access to an opted-in host provider is denied;
revalidation failure before dispatch prevents side effects, after dispatch suppresses stale
results; stream checks and unrelated-root isolation; sanitized audit identity. Continue to run
existing runtime/Electron and packaged-consumer tests. This is a prerequisite, not proof of
Terminal, Browser, orchestration, MCP, remote or mobile parity.

### Environment HTTP and WebSocket adapter for the third addition

A server-owned makeSessionApiAuthority adapter takes the verified HTTP/WS session, the
ServerEnvironment ID, required transport scope and SessionStore. It obtains a fresh persisted
principal, intersects scopes with the original authentication, checks subject/method/expiry,
and captures an immutable non-secret root. Its revalidate callback checks that captured
authority is still present and never grows it. Capture only the Effect Clock service so injected clocks remain effective across the Promise
boundary; do not retain the HTTP request context or its headers in the root callback.

HTTP invokeApi selects the host-verified root scope: access:write callers retain a write-capable
root, while orchestration:read-only callers receive a read-only root and can invoke declared read
methods. A session with both scopes selects access:write; a write-only session does not gain a new
read-scope requirement. Missing both scopes is denied. WebSocket subscribeExtensionApi supplies a
read-only root to EnvironmentExtensions.subscribeApi while retaining the acquired session stream guard for
silent cancellation. EnvironmentExtensions forwards the optional root to the runtime. Old
embedding calls retain compatibility but have no authenticated principal and cannot call
providers that require one. Legacy tool/MCP adapters and domain-specific scope requirements
remain explicitly separate; this addition does not grant orchestration or terminal control.

## Verified third addition (2026-09-10)

The host-only root is implemented and propagated from authenticated HTTP and WebSocket
adapters through EnvironmentExtensions and nested plugin API calls. Runtime entry captures
identity before asynchronous dispatch or iterator creation. Opted-in host providers reject
rootless calls; principal metadata and audit fields contain no credential material.

Verification on lxso2: runtime 80/80, no skips, including real Electron; new root tests 9/9;
EnvironmentExtensions 10/10 including exact unary/stream forwarding; session authority 5/5;
HTTP 3/3; scoped lint, server typecheck and v11 production build exited 0. The installed raw
WebSocket proof observes the same verified read-only principal in linked outer-consumer and
inner-provider stream audit records. Revocation interrupts that stream, reuse of the open
socket fails, and another login continues. HTTP write calls audit their verified root.
The installed read-only Files presentation still reads exact bytes and restores across reload.

Evidence: /home/saphid/artifacts/t3-extensions-health-rounds-20260909/root-authority and
proof/auth-session-root-v11-candidate.json, proof/files-proof-v11.json.
A fresh direct Claude Opus 5 high review launch exited 1 because its OAuth session had
expired and could not refresh; modelUsage was empty. No Claude review took place.
Luna independently reviewed the bounded implementation and installed proof scripts.

These proofs do not establish authenticated tool/MCP roots, native domain scopes, resource
leases/epochs, terminal/browser replacement, mobile or relay/tunnel parity. Legacy rootless
embeddings remain compatible and cannot access providers opting into requiresRootAuthority.
The current workspace provider has not opted in until its legacy tool path has an authenticated
adapter; the HTTP and WebSocket API paths already supply a verified root.

## Fourth bounded addition: authority check inside a host operation

A native save can await filesystem work between API admission and its mutation. Checking only
before provider dispatch and after its return cannot prevent a revoked caller's delayed
operation from starting a later side effect. The host adapter needs a way to revalidate at its
own mutation boundary. This addition is frozen before implementation.

Add optional assertAuthority(): Promise<void> to HostApiInvocationMetadata. The broker supplies
it to host unary and stream providers only. It calls the same invocation checks for cancellation,
current root authorization, caller installation/grants/scope and provider lifetime that apply
to dispatch/result delivery. Check cancellation before awaiting authorization and again after.
After return, failure, close or cancellation, retained callbacks reject. This grants no extra
authority and does not elevate a read method or read-only descendant.

The callback is host-only: no new SDK package format, public JSON argument, client-host API or
worker IPC field. Neither the callback nor other host objects appear in audit JSON. Existing
embedding fixtures remain source-compatible via the optional field. New mutation adapters must
require it and await it immediately before their side-effect boundary; do not silently proceed
if an older embedding omits it. It is a point-in-time check, not a transaction or a guarantee
against revocation after the check. Caller cancellation cannot undo a completed side effect.

Tests use actual state/barriers, not revalidation-call counts: a native handler waits, root or
grant revocation occurs, then the check rejects before a side-effect sentinel; a valid call can
proceed; retained callback after completion/stream close rejects; pending cancellation suppresses
the check; unrelated callers remain available. Independently packaged worker descendants must
preserve the same host checks while forged JSON fields cannot supply or replace the callback.
Run focused broker/worker tests, package type build, scoped lint and existing runtime compatibility.

This is a prerequisite for revision-checked Files writes. It does not add filesystem writes,
operation receipts, resource leases, Terminal control or a native panel replacement by itself.

## Verified fourth addition (2026-09-10)

Host providers now receive a lifetime-bound assertAuthority callback. Unary and stream
checks reuse the broker's current root, grant, scope, generation and cancellation checks.
Retained callbacks reject after success, provider failure, cancellation or stream close.
An independent installed worker's write call cannot forge this callback or exceed a read-only
root. Tests revoke authority at an actual pre-mutation barrier and verify another login
continues through the same broker.

Verification on lxso2: runtime 87/87 including real Electron; seven operation tests;
published external consumer 2/2; scoped lint with zero warnings, package build,
server typecheck and v13 production build all passed. A final test-only iterator spelling
change removed a lint warning and reran all seven affected tests. Installed v13 proofs pass:
ordinary Files replacement and reload, nested Terminal status against a real existing PTY,
and authenticated stream revocation/identity. Those tests are regressions of existing
installed functionality; the callback's side-effect barrier is proven by runtime tests.

Evidence: operation-authority/evidence.json under
/home/saphid/artifacts/t3-extensions-health-rounds-20260909. The independent Luna monitor
reported no actionable findings for the final bounded target and receipts. A fresh direct
Claude Opus 5 high launcher exited 1 before any model ran because OAuth could not refresh.
The callback does not add editing, durable operation receipts, resource leases or full panel
replacement. File editing remains the separate proposal in file-edit-capability-plan.md.
