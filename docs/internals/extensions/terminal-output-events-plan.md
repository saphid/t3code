# Terminal output events: parent-frozen additive contract

Baseline fb041994189bef8a1baaf98e95b283355d27e8bb, lxso2. Work spine saphid/personal-ops#128. Design reviewed by separate Luna builder and monitor; their artifacts are terminal-live-output/{builder,monitor}. This is authorized for a bounded live-output implementation, not complete Terminal replacement.

## Public boundary

Keep t3.terminal/output@1.0.0 and every old catalogue descriptor unchanged. Add t3.terminal/output-events@1.0.0, methods:[], one stream named subscribe. Reuse t3.terminal/read-output grant and require authenticated root terminal:operate. Input exactly {terminalId}, string1..128. Reject every supplied resume cursor before native lookup. API registration never grants authority. Use existing broker, provider selection, root/grant checks, audit, cancellation and transport.

The value is an exact discriminated union. Every value carries terminalId and streamEpoch (opaque host-generated current observation/incarnation identity, max128). Numbers are nonnegative safe integers:

- snapshot: {kind:"snapshot",terminalId,streamEpoch,status,contents,retainedByteLength,truncated,boundarySequence}. contents uses existing8192UTF8byte/8192UTF16unit tail. Native retained history is sanitized; explicitly distinguish it from live raw output.
- output: {kind:"output",terminalId,streamEpoch,sequence,chunkIndex,chunkCount,data}. Native sequence orders events within an epoch; broker frame sequence orders transport frames. Split one native event into bounded chunks, preserving characters and order, with explicit chunkIndex (zero-based, maximum63) and chunkCount (1..64). These bounds cover splitting the maximum256KiB admitted native event.
- reset: {kind:"reset",terminalId,streamEpoch,sequence,reason:"history-cleared"}. Clear discards previously displayed tail. No invented new snapshot at a later sequence labeled as the clear boundary.
- exit: {kind:"exit",terminalId,streamEpoch,sequence,exitCode,exitSignal}, nullable integer codes. Emit then complete: opening again requires a fresh subscription; no silent idle after exit.
- closed: {kind:"closed",terminalId,streamEpoch,reason:"terminal-closed"|"identity-changed"|"overflow"|"terminal-error"}. Emit then complete. No raw native error message/paths. Identity or scope/root failure can instead fail the generic stream if authority no longer permits any frame.

Envelope type snapshot for snapshot; data for output/exit; reset for reset; closed for closed. No cursor emitted. Absent native session fails admission; it never creates a PTY. An already-exited/error session may emit its snapshot then complete. This API is a diagnostic bounded tail plus live events, not full VT history, durable replay or a complete Terminal.

## Native race and resource model

Add a new readonly existing-session observation seam. Never call attachStream/openOrAttachForStream/open or any mutation. Do not change native wire contracts merely to expose internal observation metadata.

Capture exact session object and process/incarnation, not PID or eventSequence alone. A new object can reuse terminalId, and a restarted process can reuse the old object. Admission captures listener and snapshot under the manager state discipline; output whose native sequence is at/before the snapshot boundary is discarded, newer output delivered exactly once.

Important hazard: native drain mutates history/sequence, then awaits persistence before publishEvent. An old event may publish after close/reopen or restart. Merely filtering global events by threadId/terminalId, or reading the current epoch when an old event is published, is insufficient. Capture source identity/epoch alongside the native action at its creation; route the readonly observer with that captured identity. Do not accidentally label old bytes with a new epoch. Keep any identity enrichment internal, preserving native external event shape and behavior. No global polling. Missing observation listeners should add negligible work to native fanout.

Lifecycle mutation terminates the old native observer and appends an ordered lifecycle boundary. Bytes already delivered or queued before that boundary cannot be recalled; consumers may receive that causally earlier prefix followed by closed. No bytes from a different epoch may be labeled or delivered as the current incarnation. Observe-only acquisition and cleanup cannot change PID, dimensions, history, process env, or native listeners belonging to other clients. Cleanup is idempotent and cooperative with AbortSignal even while acquisition or next() is pending. Parent will inspect implementation details before acceptance.

Use one bounded native/provider queue (not two). Maximum8queued native events and256KiB raw UTF8 payload per observer; oversized incoming event fails visibly before enqueue. Live output chunk data max8192UTF16 units, preserve surrogate pairs at split boundaries; verify actual JSON envelope stays under broker64KiB. A raw32KiB NUL string becomes nearly192KiB JSON, so raw byte count alone cannot enforce wire bounds. Keep split metadata bounded and avoid scanning/copying giant input beyond admission checks. Overflow terminates explicitly, releases listener/queue/admission and never silently drops output. A failed stream makes no continuity guarantee; consumer must discard incomplete chunk groups and re-subscribe.

## Ownership and smallest slices

Builder owns SDK catalogue additions (existing definitions unchanged), a new native observation helper if appropriate, Manager.ts and focused Manager tests, new terminalOutputEventsApi.ts/provider tests. Keep native wire schema unchanged unless parent reviews a necessary change. Read Effect reference before Effect code. Publish initial exact types/descriptor early so parent can implement independent consumer in parallel. Report blockers immediately; do not silently weaken race/cleanup tests or claim promises are proof.

Parent owns generic typed stream binding, independent installable SDK example and packaging/type tests, EnvironmentExtensions provider registration/fallbacks/fixtures, installed client proof, build/typecheck and integration. Parent may add a separate backward-compatible TypedStreamApi/defineStreamApi/bindStreamApi helper: immutable validated descriptor plus phantom input/event types, binding through ApiClient.subscribeApi with fixed context and explicit signal. It must not change bindApi or legacy method typing and must preserve iterator return/cancellation.

Monitor independently watches builder source/tests/receipts, sends roughly-minute artifact summaries and verifies exact hashes before its verdict. No monitor source edits or duplicated heavy test runs. Heavy work uses shared lock on lxso2.

## Required acceptance

Focused native tests: no launch/write/resize/history mutation; absent/exited; snapshot-before-live acquired races; ordered exact Unicode/control bytes; clear, exit, restart/reopen/close; delayed old-source publish after reincarnation; cancellation during setup/pull; overflow exact bounds and cleanup; chunk size includes worst-case JSON escaping. Use acquired barriers/receipts, not sleeps.

Provider tests: root terminal authority plus plugin grant, immutable context, invalid schema/cursor before native reads, matching environment/project/thread/cwd/worktree, per-frame authority/scope/identity changes, sanitized failures and cleanup. The shared broker owns pre/post-pull root, grant, installation/provider generation and scope checks. EnvironmentExtensions supplies its live scope resolver to that broker and resolves again before client emission; providers must additionally verify that the actual native resource matches the admitted scope. Do not duplicate generic broker policy in each provider. Existing broker tests own provider-generation, grant and stream admission machinery; add focused integration where necessary.

Actual separate installed consumer provides a namespaced forwarding API and consumes it through public contracts, with no private app imports. Compare native PTY markers/lifecycle and public stream bytes using existing isolated test server. Preserve existing Files/Terminal output and assets baselines. Test grant/root revocation and unavailable/close behavior end to end. Full interactive Terminal, native mobile, relay/tunnel and V2 remain unproven.

Do not declare this slice complete until code, frozen-source receipts, independent review and actual installed proof agree. Stop parent and both workers at second-account30%.
