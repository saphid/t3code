# Author an installable plugin

Start with the bundled [Files provider](examples/installable-files/README.md) and [independent consumer](examples/installable-files-consumer/README.md). They are complete format-2 packages. The provider implements its own API and a shared file presentation contract; both clients call APIs through the injected host. No private app module or second React runtime is needed.

## What the current host provides

The public catalogue export contains t3.workspace/files@1 (listEntries and readText) and t3.file/presentation@1 (open). The workspace provider is host-backed; a file presentation provider is installed and explicitly selected. These contracts do not expose file writes, PTYs, a browser engine, source control mutations or orchestration controls.

The app's built-in panels are not a list of supported plugin APIs. Terminal and Browser resource and engine APIs remain unimplemented. Format 3 adds generic declared API streams; this alone does not provide PTY or Browser services. A name in a future design or an illustrative host integration example is not callable authority. Installing a probe and catching an unavailable error proves a negative test, not a working panel.

## Package shape and entry points

Copy one of the included format-2 example directories into an independent package directory. Keep t3-extension.json, client.mjs and any declared server.mjs together. Only declared bundled entries are loaded; arbitrary asset directories are not currently served. Use your own publisher.plugin identity and contribution namespace consistently.

Format 2 requires dependencies, provides and requires arrays, even when empty. provides contains versioned API descriptors with method input/output JSON schemas, read/write effects and required grants. A plugin may own APIs in its own namespace. Shared catalogue contracts must match the public descriptor exactly; a plugin cannot change their schema or remove their grants.

A dependency names a plugin ID, semver version range and any required API ranges. requires declares selected shared API requirements. Dependencies are installed separately. Missing, incompatible, disabled, cyclic or unselected requirements produce an unavailable state; registration does not grant access.

The client entry exports a synchronous factory receiving ClientHost. Use its injected React, invokeApi and discoverApis bindings. A view's session supplies scoped context and cancellation; combine local cancellation with the session lifetime. The server entry exports its declared tools and APIs. An API handler uses its authenticated session.invokeApi for declared requirements and dependencies. The older invokeTool/session.invoke bridge remains supported for format-1 packages; it is not a way to invent a missing shared API.

## Discover, select and call

Use the installed client's discoverApis with the view context and a cancellation signal. Check API ID, version, selection, health and unavailable reason. The administrator chooses a shared provider in Settings; registration order must not choose it. For a call following discovery, pass expectedGeneration to reject a changed provider. Rediscover after reconnect; generation tokens are temporary concurrency checks, not durable resource IDs.

For typed calls import bindApi from @t3tools/extension-sdk/capabilities and a typed descriptor such as workspaceFilesApi from @t3tools/extension-sdk/catalogue. The Files examples also demonstrate the portable JSON invocation form. Server-side validation checks both inputs and results; the caller must still handle denied access, cancellation, stale scope, unavailable dependencies and bounded/truncated data.

## Install and verify

Open Settings → Integrations → Environment extensions on the target environment. Supply the package directory on that machine, select the intended projects and capabilities, acknowledge trusted code execution and install. Choose Use for t3.file/presentation for the Files provider, then use the ordinary Files entry. Install the independent consumer to exercise a plugin-owned API.

Check the real installed path: a successful package validator checks shape only. A successful loader checks registration only. A working plugin additionally needs successful authorized domain calls and observable behavior. Keep separate evidence for validation, install, actual API result, reload, revocation, update, rollback and dependency removal. Tests with a mock transport do not establish host or native engine parity.

Update and rollback retain current grants. Applying selected permissions replaces the complete grant set; an empty set revokes T3-provided access. Do not retry writes on another provider automatically. Cancellation suppresses stale delivery where possible and does not undo physical effects already performed.

## Stream between plugins

Format 3 preserves the manifest surface API version and adds separately declared streams with
name, inputSchema, eventSchema and requiredGrants. A stream API may omit methods; methods and
streams together must contain at least one operation. Format 2 cannot declare streams.

Start with the [shared counter provider](examples/installable-stream-provider/README.md) and
[separate worker consumer](examples/installable-stream-consumer/README.md). They demonstrate
an explicit write API, a coalescing snapshot stream and a versioned plugin dependency. The
counter is intentionally in-memory example state, not a durable resource or a native panel.

The client calls host.subscribeApi(request, signal). A server handler calls
session.subscribeApi(requestWithoutContext); the host supplies its caller identity, captured
scope and cancellation lifetime. Both return AsyncIterable frames. Every frame has a stable
host-generated streamId for that subscription, an increasing sequence, a type
(snapshot, data, reset or closed), JSON value and optional provider-owned cursor. Provider
handlers yield events without streamId or sequence. An API stream session also exposes
resumeCursor.

Consume with for-await and use return or AbortSignal to release the subscription, including
a pending next. Do not issue concurrent next calls. Never poll unary APIs to imitate a stream.
The worker protocol allows one pull at a time; the app transport permits one queued and one
in-flight frame. Frames are bounded to 64 KiB. The host limits streams to eight per participating
plugin and 64 per environment. A live subscription has no unary total-call deadline.

All stream ancestry is read-only: a provider cannot turn a subscription into a nested write
even if its package has write grants. Scope, grants, package identity and provider selection
are rechecked, and revocation cancels affected streams. Registration creates no grants.

Before calling, the app negotiates supportedPackageFormats including 3 and supportsApiStreams.
A reconnect requires rediscovery and explicit resubscription; the host does not silently replay
a write or assume a cursor still applies. Provider update, rollback, disable or removal likewise
invalidates pending dependent iterators: handle their terminal error or cancellation, rediscover
the dependency, and create a fresh subscription. A host-mounted client view follows the host's
installation lifetime and is reloaded or disposed by that host; an independent server consumer
must close its iterator and perform that rediscovery and fresh subscription itself. Cursor
replay/reset semantics and bounded upstream buffers belong to the provider. A generic
subscription does not allocate a durable session, resource lease or native engine attachment.

## If an API is missing

Stop the dependent implementation and report the requested operation, actual catalogue/discovery evidence, minimal probe, command exit status and expected user behavior. Mark proposed API names as proposed. Do not substitute private React bindings, raw RPC, an unrelated engine or fake output. Record what can be packaged independently and what the host must add before a genuine end-to-end attempt.

Packages currently run trusted Node and client JavaScript. Broker checks protect T3-provided capabilities but do not sandbox ambient code access. Web and desktop support these views; React Native and SwiftUI need separate renderer hosts. Remote/relay/tunnel and full panel parity require their own evidence.

### Authoring details verified by independent workers

A server entry always exports a tools array, including when it provides only APIs:

```js
export default { tools: [], apis: [/* declared API handlers */] };
```

The server tool IDs must exactly match the package descriptor. A named dependency includes
an explicit `apis` array; use `apis: []` when only the plugin/version dependency is needed.

Create as many dormant subscription descriptions as needed; active admission starts on the
first pull. At most eight active or closing streams may belong to a worker. Always close
an iterator when leaving its scope. `await iterator.return()` waits for bounded producer
cleanup acknowledgement; a separate host call or sleep is not required before replacement.
Abort interrupts pending reads immediately. A producer that cannot finish cleanup within
the grace period fails visibly, and its unrelated peers remain running.

For concurrency tests, observe a precise event or query state through an independent public
operation. A consumer-side event before its next pull does not prove a producer has entered
that pull. Assertions must require the intended result, rather than accepting both a value
and cancellation/limit errors.
