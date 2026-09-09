# Public stream implementation round

Baseline: 44a3fc50fd9caa4665f71f34b15818bfcf7d29e8. This document freezes the next incompatible shape before code. Parent owns decisions and server/client transport; Luna owns SDK/runtime implementation; separate Luna monitor reads receipts and reports via summary files.

## Public shape

Add package format 3 while preserving format1/2. Format3 initially supports declared API streams; reject stream declarations in format2 rather than half-loading them. Existing surface manifest API version1 remains unchanged. API definitions gain optional streams:[{name,inputSchema,eventSchema,requiredGrants}]. A definition must contain at least one method or stream. A provided stream is always read-only authority. Shared API descriptors still must match catalogue exactly.

ApiStreamInvocation: {id,versionRange,name,input,context,expectedGeneration?,cursor?}. cursor is opaque/bounded and interpreted only by the provider. Provider registration adds streams:[{name,subscribe(input,session)}]; subscribe returns AsyncIterable<ApiStreamEvent>. ApiStreamEvent is {type:"snapshot"|"data"|"reset"|"closed",value:Json,cursor?}. The session exposes readonly resumeCursor if present. The runtime wraps each event as ApiStreamFrame with host-generated streamId and strictly increasing sequence. Input and event value schemas are validated; full encoded frames are bounded to64KiB and cursors to1024 characters.

ClientHost/ApiClient gains subscribeApi(request,signal):AsyncIterable<ApiStreamFrame>. A typed bindStream helper is optional if simple. HostApiProvider may expose subscribe with the same scoped host metadata used for unary calls. Runtime public subscribeApi(id,contentHash,request,signal) uses the same provider/dependency selection, captured grant/scope identities and generation checks as invokeApi. All nested stream authority is read-only. Broker identity and provider metadata are authoritative; plugin JSON cannot spoof them.

## Delivery and ownership

Start with demand-driven single-credit iteration: a consumer next() grants one delivery credit. Worker IPC has stream-open, ready, pull, frame, end/error and cancel. At most one pull is outstanding per stream; reject concurrent next or serialize with an explicitly bounded pending slot. No unbounded frame queue or timer polling. This is flow control, not repeated domain reads. The server transports the AsyncIterable through the existing authenticated RPC stream mechanism; inspect and test its backpressure rather than invent another socket.

Limit eight active streams per plugin and64 per environment. Existing startup/worker handshake deadlines remain; a live stream must not inherit the unary total-call timeout. Cancellation, iterator.return(), transport disconnect, grant/scope/provider changes and consumer/provider failure close the affected stream and discard late frames. Bound cleanup; a producer ignoring cancellation cannot retain worker capacity indefinitely or block unrelated installations. Schema violations terminate that stream visibly. Capture root and provider authority through nested plugin consumers; registration does not add grants.

The domain producer owns snapshot/replay/reset semantics and bounded upstream subscriptions. Slow terminal consumers later receive reset-required instead of an unbounded backlog or silently lost bytes. Generic stream support alone does not establish PTY/browser behavior, resource leases or native engine support.

## Negotiation and transport

Installation list adds optional supportedPackageFormats and supportsApiStreams. Web negotiates before accepting/loading format3 clients or opening unknown RPCs; older clients/hosts retain format1/2 behavior with clear unsupported states. New subscribeExtensionApi authenticated RPC accepts installed identity/hash and ApiStreamInvocation, returns bounded ApiStreamFrame. Read transport authority plus current plugin/scope grants is required. Do not add generic write control to this stream.

Resource session ownership additionally requires an authenticated transport principal, durable resource records and transient attachment leases. Those are the next adapter prerequisites and must not be fabricated by the stream producer.

## Acceptance for this round

Real independent format3 producer+consumer workers must exchange events through declared stream contracts with backpressure. Tests: malformed declarations, missing/dependent provider, wrong versions, unauthorized grants/scope, read-to-write attenuation, cancellation while next is pending, disable/update/revoke, late producer results, malformed/oversize events, max streams, early iterator return, unrelated worker survival and format1/2 regression. Server/web must prove one installed client consumes a real producer stream through authenticated RPC and stops after revocation. No Terminal/Browser clean bill until actual domain adapters and installed presentation parity also pass.
