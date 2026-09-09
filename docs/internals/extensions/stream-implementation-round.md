# Public stream implementation round

Baseline: 44a3fc50fd9caa4665f71f34b15818bfcf7d29e8. This document freezes the next incompatible shape before code. Parent owns decisions and server/client transport; Luna owns SDK/runtime implementation; separate Luna monitor reads receipts and reports via summary files.

## Public shape

Add package format 3 while preserving format1/2. Format3 initially supports declared API streams; reject stream declarations in format2 rather than half-loading them. Existing surface manifest API version1 remains unchanged. API definitions gain optional streams:[{name,inputSchema,eventSchema,requiredGrants}]. A definition must contain at least one method or stream. A provided stream is always read-only authority. Shared API descriptors still must match catalogue exactly.

ApiStreamInvocation: {id,versionRange,name,input,context,expectedGeneration?,cursor?}. cursor is opaque/bounded and interpreted only by the provider. Provider registration adds streams:[{name,subscribe(input,session)}]; subscribe returns AsyncIterable<ApiStreamEvent>. ApiStreamEvent is {type:"snapshot"|"data"|"reset"|"closed",value:Json,cursor?}. The session exposes readonly resumeCursor if present. The runtime wraps each event as ApiStreamFrame with host-generated streamId and strictly increasing sequence. Input and event value schemas are validated; full encoded frames are bounded to64KiB and cursors to1024 characters.

ClientHost/ApiClient gains subscribeApi(request,signal):AsyncIterable<ApiStreamFrame>. ToolSession also gains subscribeApi(requestWithoutContext):AsyncIterable<ApiStreamFrame>; the worker session supplies the immutable host context and lifetime. This enables a separately packaged server-side consumer to consume another provider's stream through declared dependencies. Worker-to-host stream requests/pulls/cancellation inherit the same read-only ancestry and bounded delivery as host-to-provider streams. A typed bindStream helper is optional if simple. HostApiProvider may expose subscribe with the same scoped host metadata used for unary calls. Runtime public subscribeApi(id,contentHash,request,signal) uses the same provider/dependency selection, captured grant/scope identities and generation checks as invokeApi. All nested stream authority is read-only. Broker identity and provider metadata are authoritative; plugin JSON cannot spoof them.

## Delivery and ownership

Start with demand-driven single-credit iteration: a consumer next() grants one delivery credit. Worker IPC has stream-open, ready, pull, frame, end/error and cancel. At most one pull is outstanding per stream; reject concurrent next or serialize with an explicitly bounded pending slot. No unbounded frame queue or timer polling. This is flow control, not repeated domain reads. The server transports the AsyncIterable through the existing authenticated RPC stream mechanism; inspect and test its backpressure rather than invent another socket.

Limit eight active streams per plugin and64 per environment. Existing startup/worker handshake deadlines remain; a live stream must not inherit the unary total-call timeout. Cancellation, iterator.return(), transport disconnect, grant/scope/provider changes and consumer/provider failure close the affected stream and discard late frames. Bound cleanup; a producer ignoring cancellation cannot retain worker capacity indefinitely or block unrelated installations. Schema violations terminate that stream visibly. Capture root and provider authority through nested plugin consumers; registration does not add grants.

The domain producer owns snapshot/replay/reset semantics and bounded upstream subscriptions. Slow terminal consumers later receive reset-required instead of an unbounded backlog or silently lost bytes. Generic stream support alone does not establish PTY/browser behavior, resource leases or native engine support.

## Negotiation and transport

Installation list adds optional supportedPackageFormats and supportsApiStreams. Web negotiates before accepting/loading format3 clients or opening unknown RPCs; older clients/hosts retain format1/2 behavior with clear unsupported states. New subscribeExtensionApi authenticated RPC accepts installed identity/hash and ApiStreamInvocation, returns bounded ApiStreamFrame. Read transport authority plus current plugin/scope grants is required. Do not add generic write control to this stream.

Resource session ownership additionally requires an authenticated transport principal, durable resource records and transient attachment leases. Those are the next adapter prerequisites and must not be fabricated by the stream producer.

## Acceptance for this round

Real independent format3 producer+consumer workers must exchange events through declared stream contracts with backpressure. Tests: malformed declarations, missing/dependent provider, wrong versions, unauthorized grants/scope, read-to-write attenuation, cancellation while next is pending, disable/update/revoke, late producer results, malformed/oversize events, max streams, early iterator return, unrelated worker survival and format1/2 regression. Server/web must prove one installed client consumes a real producer stream through authenticated RPC and stops after revocation. No Terminal/Browser clean bill until actual domain adapters and installed presentation parity also pass.

## Transport window and cancellation decision

The Effect RPC client acknowledges after bounded queue admission. This round explicitly sets
streamBufferSize: 1: a stalled consumer can leave one frame buffered and one awaiting
acknowledgement. The worker protocol still grants exactly one producer pull at a time.
apiStreamTransport.test.ts proves the bound using the real RPC client/server ACK and interrupt
machinery: after one delivered frame stalls, only two more frames can be produced; interrupt
runs producer cleanup. This test is in-memory RPC, not network or installed-package proof.

Client iterator return aborts first, including a pending next, before awaiting cleanup.
A plugin stream uses one authenticated connection lifetime; it is not silently resubscribed.
Reconnection requires rediscovery and a provider-understood cursor or a fresh snapshot.

## Installed proof example

Two independently packaged format-3 examples own and consume namespaced counter-state APIs.
The provider exposes an explicit write increment plus a coalescing read-only snapshot stream.
The consumer runs in a separate worker and exposes a stream derived from its declared provider
dependency. This gives the installed UI/RPC path a real state change to observe without
pretending that generic streaming implements a PTY or Browser engine. State is explicitly
in-memory and resets with a new epoch on worker restart. Durable domain resources remain a
separate acceptance gate.

## Luna authoring trial: observations from the resumed round

The builder and a separate Luna medium source monitor work on lxso2; the parent owns contracts, diagnosis, integration and acceptance. The monitor performs six observations per assignment and reports current source separately from old receipts. Account 2 quota, not the exhausted primary account, controls the 40% stop.

Observed problems and required improvements:

- A worker repeatedly reported requested fixes before those changes appeared on disk. Acceptance now requires source hashes plus an actual test command and exit receipt. Progress prose alone does not advance a gate.
- The cancellation test originally waited on a catalogue notification already emitted during installation and asserted an internal health name as a public resolution status. Tests must use public types and operation-specific receipts. Examples should include typed fixtures for public unavailable states.
- A consumer-side receipt before a second pull did not prove the producer had entered that pull. Failure-isolation tests need a producer-side receipt through an authorized public API before cancellation.
- Successful stream transport alone missed a provider-state regression: closing a view killed its worker. The independently packaged counter test now closes and reopens the view and verifies retained state.
- Worker sessions and client hosts have deliberately different subscription signatures: sessions inject caller context and lifetime. The SDK and published-package declaration checks must demonstrate both forms.
- React examples create cancellation controllers inside each effect lifetime, including effect replay. A controller retained from a completed effect must not poison a new subscription.

The stream slice has the bounded verification recorded below. The independently packaged counter is a transport and lifecycle example, not evidence of terminal, browser, source-control, orchestration or durable resource parity. Existing Files proof remains a read-only public-API replacement; the other panel wrappers are not accepted as ordinary installable replacements.

## Dependent client lifetime correction

The installed network update proof exposed a missing boundary: a provider update ended the
old stream, but the dependent client retained its stale rendered value because only its own
package hash and grants controlled reload. Client identity must include the transitive named
dependency and selected API-provider closure (code hash, enablement, grants, selection and
resolution). A change in that closure aborts and reloads the dependent client. Unrelated
catalogue changes must retain its current viewer and subscription. This changes no wire or
SDK schema; a targeted controller regression and the installed update/rollback proof verify it.

## Awaited cleanup acknowledgement

The stricter independent cleanup test held a cooperative producer's return and queried the
consumer worker through a separate public status tool. It proved consumer iterator.return()
resolved before producer cleanup completed. Add producer settlement tracking in the host and
an internal api-stream-settled acknowledgement back to the consuming worker. Awaited return
waits for this acknowledgement; abort still interrupts pending reads immediately. Existing
250 ms producer cleanup/termination bounds remain, with a bounded 1 s consumer acknowledgement
deadline to isolate a disconnected or broken host. Closing subscriptions count against worker
admission until acknowledged. Natural end, repeated close and worker exit also settle waiters.
This is an internal IPC lifecycle correction; no public package or RPC schema changes.

## Verified stream checkpoint (2026-09-10)

The final v9 production bundle passed installed-package checks on lxso2: separate provider
and consumer workers, two RPC clients, a public increment observed by the dependent stream,
server restart, provider update and rollback, removal and reinstall, plugin project-grant
revocation and regrant, disable and enable. Package installation and grants survived restart;
the counter explicitly reset its ephemeral state. These two clients shared one browser
profile, so this is not independent-device or principal isolation evidence.

Focused runtime verification passed 71 tests, including real Electron. Published-package
consumer verification passed 2 tests. Web stream/dependency checks passed 21 tests, with
server and web typechecks passing. The installed tests and earlier Files baseline comparison
remain under /home/saphid/artifacts/t3-extensions-health-rounds-20260909 and
/home/saphid/artifacts/t3-extensions-capabilities-20260909/proof on lxso2. Historical failed
attempts remain alongside numbered passing receipts; use the final evidence manifest.

This acceptance covers plugin grants and stream lifecycle. It does not establish revocation
of an authenticated transport session while its WebSocket remains open. The existing server
checks that session at upgrade and captures it in the RPC layer; revocation emits a session
change without terminating the socket. Host-only authenticated principal propagation and
active-session invalidation must precede resource leases and powerful native domain adapters.
The server-generated RpcClientId is connection bookkeeping, not user authority.

The independent Luna review initially inspected its old worker checkout and reported gaps
already fixed in integration. The parent rejected that report; the corrected audit named
the exact integration paths and hashes. Monitor tasks must verify the checkout against the
assignment before accepting findings. A remaining lifecycle documentation gap was then fixed.
Passing example tests are sufficient only for their named behavior; they cannot establish
full Files, Terminal, Browser, Diff, source-control or orchestration parity.
