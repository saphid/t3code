# Authenticated authority prerequisite

Status: planned next slice after public streams. This freezes host-only additions before implementation; it does not advertise a callable plugin resource API.

## Why this precedes resources

The broker currently binds plugin identity, grants, ancestry and provider generation. It has no authenticated root session. WebSocket authorization captures the session at upgrade; SessionStore revocation emits a change but does not close that socket. Resource leases must not rely on plugin-supplied context.client, resource IDs or JSON identities. Effect RPC allocates RpcClientId on the server per transport; that ID is process-local bookkeeping, not an authenticated principal.

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
