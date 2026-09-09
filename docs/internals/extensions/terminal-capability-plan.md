# Public terminal capability proposal

Status: proposed follow-on slice, not an implemented API or a terminal replacement claim. This proposal extends the [capability architecture](capability-system.md). It was prepared from the lxso2 integration source before any streaming, resource, or terminal contract changes. Browser capabilities must use the same caller, resource, and stream primitives.

## Existing behavior and boundaries

The current [terminal extension](../../../apps/web/src/extensions/terminal/index.tsx) injects private TerminalBindings and renders PersistentThreadTerminal components. It is a privileged wrapper. An installable package cannot reproduce its behavior with the current unary SDK alone.

The underlying host already owns PTYs through TerminalManager. Its open, write, resize, clear, restart, close, attachStream and metadata subscription operations are the right adapter boundary. The client state layer serializes lifecycle commands per thread and coalesces resize per session. An ordinary package must obtain equivalent behavior through public contracts without importing either that state layer or ThreadTerminalDrawer.

Several existing behaviors constrain the design:

- Terminal IDs are chosen by the client, usually term-N, and sessions are keyed by thread plus terminal ID. Adopt existing IDs rather than silently allocating replacement shells.
- TerminalManager keeps active sessions in memory and persists bounded history. The default history allowance is 5,000 lines and 8 MiB. It is not a durable live-PTY supervisor.
- attachStream subscribes before taking its snapshot and buffers intervening events. Preserve this no-gap handoff.
- Current attach can create a terminal when cwd is supplied, restart an exited terminal when restartIfNotRunning is true, and resize an existing PTY using cols/rows. It cannot be exposed as a read-only public subscription unchanged.
- Existing event sequence numbers are optional on the wire. Public replay cursors require mandatory sequence and an explicit resource epoch; updatedAt timestamps are not replay cursors.
- The native renderer uses the repository's Ghostty/WASM engine, including keyboard/mouse/bracketed-paste behavior. This is not an xterm wrapper. Its runtime imports two Vite asset URLs from private source.
- Current package storage copies only manifest and declared client/server entry files and caps the whole package at 1 MiB. It cannot honestly package the native renderer's WASM assets as it stands.

These constraints are visible in [terminal contracts](../../../packages/contracts/src/terminal.ts), [TerminalManager](../../../apps/server/src/terminal/Manager.ts), [client terminal state](../../../packages/client-runtime/src/state/terminal.ts), and [Ghostty runtime](../../../apps/web/src/terminal/ghostty/runtime.ts).

## Common host identity before domain adapters

Extend the host adapter call context, not JSON input, with a trusted HostApiInvocationContext:

- Host-generated callId and optional parentCallId, rootCallerId and immediate callerId.
- Selected providerId and providerGeneration.
- rootPrincipal containing the authenticated session identity, optional connection identity, and whether entry came from a client, agent, or host operation. HTTP calls need not have an enduring renderer connection; engine attachment binds a separate authenticated connection when required.
- Caller installation/content/grant generations for the authority chain.
- Validated ViewContext and AbortSignal.

The HTTP/WS/agent adapter constructs rootPrincipal. A plugin's context.client, input properties, surface ID, requestId, or resource namespace never supplies authority. The broker supplies the remaining fields after grant/scope checks. Domain adapters need this to bind leases without impersonating an existing MCP or browser provider session.

Keep this host-only context separate from optional user correlation metadata. Audit stream open/close, denied control operations and control receipts with the existing host call ancestry. Do not log terminal input, output, clipboard contents, environment values, or every output frame.

## Shared resource model

Use existing ResourceRef identity with namespace t3.terminal.session, an opaque host session ID, and environment/project/thread scope. Maintain a host-owned mapping to the existing threadId/terminalId pair. Imported term-N sessions keep their underlying PTY and history.

Separate three lifetimes:

1. A durable resource record identifies the terminal, its owner provider, legacy mapping, launch-scope revision, and resource epoch.
2. A process instance has running/exited/error state and a PID that is never a durable identity.
3. An attachment lease belongs to the authenticated principal and caller chain. Closing a view, hiding a dock or disconnecting a device releases that attachment, not the PTY.

An internal lease records leaseId, resource, resourceEpoch, owner provider/generation, rights, principal and caller generations. The client receives a bounded opaque handle. Supplying a handle does not grant access: every operation validates its owner, scope, epoch and rights.

Provider selection controls new acquisition and presentation. Existing terminal resources remain bound to their original backend provider. Selecting another backend must not reconnect a saved view to a new shell that happens to share a label. Disabled/uninstalled backends leave durable records unavailable; migration requires an explicit adapter operation that can actually transfer ownership. A presentation plugin can be replaced while the host-owned PTY remains unchanged.

A workspace revision change invalidates control leases instead of silently directing input into a terminal rooted at an obsolete worktree. Preserve resource identity/history and report launch-scope-changed. A subsequent explicit authorized decision may restart or reattach according to host policy. Switching to another thread never retargets an existing handle.

After a client reload or reconnect, reattach to the same resource. After an environment server restart, the present TerminalManager cannot promise the same running process. Report history-only/exited-or-unknown and offer explicit restart. Persisting history is not proof that shell state, subprocesses, alternate screen or running commands survived. Live process survival requires a separately justified durable PTY supervisor; it is outside this initial adapter slice.

## Generic streaming extension

Do not implement terminal output as repeated unary reads or a terminal-specific core switch. Add one public streaming operation model reusable by terminal, browser, source control and orchestration.

The proposed portable API definition gains separately declared streams with name, inputSchema, eventSchema and requiredGrants. Streams are observational/read-only; controls remain ordinary write methods. Server API registration must match every declared stream exactly and expose an AsyncIterable implementation or an equivalent cancellable producer interface. Independent TypeScript consumers receive a typed subscribeApi binding.

The initial SDK shape is conceptually subscribeApi(request, signal) -> AsyncIterable<ApiStreamFrame<T>>. Request retains API ID/range, stream name, input, context, expected generation and an optional opaque resume cursor. Frame envelopes contain a host stream ID, monotonically increasing sequence, optional resumable cursor and a bounded payload. Distinguish initial snapshot, live data, reset-required and terminal closed/error states. A stream carries inherited read-only authority; nested API calls cannot gain write capability.

This is incompatible with the current format-2 executable handshake and unary-only client host. Prefer a format-3 discriminator while keeping surface manifest API version 1 and ViewRecord version 1. Preserve format-1/2 loaders. Do not merely add ignored stream fields to format 2 and advertise a half-supported package. Installation-list protocol negotiation must advertise supported package formats and streaming/assets support before a client opens a new RPC. Older hosts reject format 3 clearly; older clients show an unavailable renderer rather than entering unknown-method retries.

Use one authenticated subscribeExtensionApi WS operation and the same extension broker selection/authority logic. Worker IPC adds generic subscribe/frame/ack/cancel messages; it does not carry raw app stores or a dedicated terminal socket. A transport adapter for relay/tunnel uses existing authenticated connection machinery. A stream ID belongs to a particular authenticated connection and invocation generation; ACK and cancel messages validate that ownership.

Flow control requirements:

- At most 32 KiB terminal data per frame and at most 64 KiB encoded generic frame. Split by encoded byte size without corrupting UTF-8 or ANSI byte order.
- Negotiate bounded credit; initial target eight frames/256 KiB buffered per stream, eight streams per plugin and 64 per environment. These are explicit limits to measure, not an excuse to increase the existing unary result cap.
- The consumer ACKs the highest contiguous consumed frame and returns credit through transport control, not a polled API method. The server and worker must not accumulate unbounded queues while awaiting a consumer.
- A slow or hidden view must not pause the PTY for all other viewers. If its retained window expires, signal reset-required, discard that attachment's queued delta and take a new consistent snapshot. Never silently drop terminal output and continue rendering a corrupt escape sequence.
- Snapshot production and live subscription share one sequence boundary. Split large retained history across snapshot frames, finish with snapshot-end at that boundary, then deliver later events. Buffer only within the explicit window; if production outruns the snapshot consumer, reset or fail the attachment visibly.
- Abort releases stream resources and subscriptions on explicit detach, disconnect, scope/grant revocation, plugin update/disable, provider generation change or resource close. Subsequent stale frames are suppressed even when a producer ignores cancellation.
- Do not apply the unary 15-second total lifetime timeout to an interactive stream. Bound startup, queued bytes and producer shutdown; connection lifecycle/cancellation controls the live subscription. Do not introduce an application polling loop.

Use a composite resource epoch and sequence cursor. A cursor from another resource, provider epoch or environment is rejected. An expired cursor returns reset-required. Initially, history replay may reproduce the same bounded raw-history behavior as the built-in renderer; it must not claim perfect VT emulator state reconstruction after history truncation. Full alternate-screen fidelity needs direct comparative evidence or a richer snapshot contract.

## Terminal API contract families

The names below are proposed generic catalogue entries, not advertised providers.

| API                      | Operation                          | Effect and host authority                                                                                        |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| t3.terminal/sessions     | acquire or import existing session | Write, t3.terminal/create or explicit existing-resource attach authority; request identity deduplicates creation |
| t3.terminal/sessions     | inspect                            | Read, t3.terminal/read; bounded metadata without full history or environment secrets                             |
| t3.terminal/sessions     | metadata stream                    | Read, t3.terminal/read, filtered to authorized project/thread resources                                          |
| t3.terminal/sessions     | output stream                      | Read, t3.terminal/read; existing resource only, no implicit spawn/restart/resize                                 |
| t3.terminal/sessions     | input                              | Write, t3.terminal/input; exact ordered bytes to one resource/epoch                                              |
| t3.terminal/sessions     | resize                             | Write, t3.terminal/resize; coalesced per resource and authorized controlling lease                               |
| t3.terminal/sessions     | clearHistory                       | Write, t3.terminal/clear; distinct from sending Ctrl-L or clearing only local renderer state                     |
| t3.terminal/sessions     | restart                            | Write, t3.terminal/restart; explicit new process epoch and restart receipt, preserving resource identity         |
| t3.terminal/sessions     | close                              | Write, t3.terminal/close; exact session, running-subprocess policy checked, explicit history deletion choice     |
| t3.terminal/presentation | open                               | Read descriptor creation; references an existing terminal resource and supported dock/side placement             |
| Shared resource API      | attach/release                     | Acquire/release scoped observational attachment, never implicit PTY destruction                                  |

Do not expose the existing close-with-omitted-terminalId operation as an accidental close-all. Batch close, if needed for native parity, is an explicit bounded resource list with per-resource authorization and receipts.

Launch requests use a resolved project/thread workspace and optional confined relative subdirectory. Plugins do not submit an authoritative absolute cwd, arbitrary environment map or provider credential. Host-owned launch profiles refer to a connected provider instance and approved settings; response metadata describes support without returning secrets. Preserve native provider-instance environment preparation through the existing host service, behind an explicit grant.

Input does not inherit retry safety from HTTP. Include a per-resource input operation ID and order fence; reconnect never resends unknown input blindly. Duplicate IDs return their prior receipt where retained; expired deduplication windows return unknown-outcome rather than execute again. Terminal input may already have reached a subprocess when cancellation occurs. Resize is latest-wins within a controlling lease. Multiple devices must not endlessly resize the same PTY to different dimensions; control ownership and takeover must be explicit.

New create/restart/close receipts report the actual resource/process epoch and host settlement. A success response cannot merely mean an extension worker queued a callback.

## Independent renderer packaging and public integrations

Extract the renderer engine into an independently publishable package or allow the terminal plugin to bundle its own equivalent engine. Sharing Ghostty engine code is compatible with an ordinary plugin if it has public exports and no app store, private React component, RPC singleton or Electron-only global imports. Wrapping ThreadTerminalDrawer is not acceptable.

Format 3 also needs bounded, content-addressed package assets: declared relative paths, digests, MIME types, per-file and aggregate limits, symlink/traversal protection, and authenticated asset retrieval bound to installation hash. The plugin resolves its declared WASM via a public asset loader, not Vite source aliases or a baked server origin. Host returns bytes or a revocable same-client blob URL as appropriate; remote/relay authorization stays in the host loader. Do not smuggle multi-MiB WASM through the existing 64 KiB JSON API or silently raise the package cap without a measured asset allowance.

The package owns terminal canvas rendering, selection, keyboard/paste encoding, tabs, split groups and terminal-specific restore state. Public APIs must cover its remaining integrations:

- Surface open/close/activate and moving the same resource between bottom dock and side panel.
- Clipboard, file/URL navigation and preferred editor operations with normal user-gesture rules.
- Composer context insertion for selected output, including terminal resource provenance and bounded excerpt.
- Theme/font/accessibility preferences and resolved keybinding actions. The package must not import useClientSettings, terminalUiStateStore, rightPanelStore or composer stores.
- Close confirmation and running-subprocess warning using host resource metadata. Hiding or unmounting a renderer does not count as confirmation to kill a process.

Persist terminal IDs/resource references, group/split arrangement, active tab and presentation preferences in versioned provider-scoped restore state. Keep terminal output in host history/stream storage, not localStorage. Provider-specific opaque renderer state must never be transferred to another provider automatically.

## Small coherent migration and proof

First implement and test the generic trusted invocation context, resource lease and streaming boundaries. Use an independent tiny producer/consumer package to prove streaming registration, authorization, resume, backpressure and failure isolation without terminal code.

Then adapt TerminalManager to read-only existing-session snapshot/live delivery and explicit write controls. Preserve native command behavior while replacing the built-in's private terminal data/control binding with a public SDK adapter. It should be possible to compare both consumers against the same PTY.

Next package a real terminal renderer with its declared assets and public integrations. Replace one terminal presentation through generic provider selection while preserving the same underlying resource and PID. Keep the full built-in reachable until exact parity is established; do not count a text-output viewer as a terminal replacement.

Use lxso2 and the existing heavy-check lock. Preserve baseline metrics and fixture commands. Required evidence includes real PTY input/output, Unicode and ANSI ordering, resize, Ctrl-C, bracketed paste, selection/copy/context insertion, URL/file links, clear versus restart, exited process, new tab/splits, dock/side movement, close protection and provider-instance launch behavior. Cover hidden/unmounted/reloaded views, two viewers, reconnect, environment restart, revoked grants, slow consumer/reset, output beyond 8 MiB, provider crash/update/rollback and unaffected independent sessions. Compare rendered content and process identity, not just transport events.

Measure bytes, queued memory, frame count and input-to-output latency against the built-in on the same fixture. Verify native web and Electron behavior separately. React Native and SwiftUI need explicit renderer/transport decisions; browser-origin portability is not mobile implementation proof. V1 thread IDs may map directly to existing terminal records, while V2 session/thread adapters must validate real ownership and never manufacture equivalence.

## Explicitly impossible or unproven today

The installed format-2 path has no generic streaming API, authenticated asset delivery, durable terminal resource catalogue or public Ghostty package. It cannot presently replace the native interactive terminal. Current TerminalManager history persistence does not provide live PTY survival across environment restart. Existing raw history replay does not prove exact alternate-screen restoration after truncation. Client code and Node workers remain trusted rather than sandboxed. Full terminal parity, browser-shared streaming, mobile rendering and V2 terminal ownership remain unproven until the implementation and comparative evidence above exist.

## Implemented prerequisite boundary

The current runtime now passes immutable HostApiInvocationMetadata to host API adapters: host call/parent IDs, root/immediate plugin IDs, selected provider lifetime, and each caller installation/content generation. Scope and cancellation remain separate existing arguments. This does not yet carry an authenticated transport principal, bind native connections, allocate resource leases or provide streams. The broader context proposed above is still required before Browser/Terminal ownership can be implemented safely.
