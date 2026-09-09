# Author an installable plugin

Start with the bundled [Files provider](examples/installable-files/README.md) and [independent consumer](examples/installable-files-consumer/README.md). They are complete format-2 packages. The provider implements its own API and a shared file presentation contract; both clients call APIs through the injected host. No private app module or second React runtime is needed.

## What the current host provides

The public catalogue export contains t3.workspace/files@1 (listEntries and readText) and t3.file/presentation@1 (open). The workspace provider is host-backed; a file presentation provider is installed and explicitly selected. These contracts do not expose file writes, PTYs, a browser engine, source control mutations or orchestration controls.

The app's built-in panels are not a list of supported plugin APIs. Terminal and Browser resource/stream/engine APIs remain unimplemented. A name in a future design or an illustrative host integration example is not callable authority. Installing a probe and catching an unavailable error proves a negative test, not a working panel.

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

## If an API is missing

Stop the dependent implementation and report the requested operation, actual catalogue/discovery evidence, minimal probe, command exit status and expected user behavior. Mark proposed API names as proposed. Do not substitute private React bindings, raw RPC, an unrelated engine or fake output. Record what can be packaged independently and what the host must add before a genuine end-to-end attempt.

Packages currently run trusted Node and client JavaScript. Broker checks protect T3-provided capabilities but do not sandbox ambient code access. Web and desktop support these views; React Native and SwiftUI need separate renderer hosts. Remote/relay/tunnel and full panel parity require their own evidence.
