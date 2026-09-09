# Capability system and installable panel replacement

Status: approved implementation direction for this work, not a claim of implemented capabilities. Baseline: 967210389d2d5fb857baa05d3ba4c7d5c93d1d0c. Existing format-1 packages and native wrappers remain compatible while replacements are proven.

## Product acceptance

An installed package must provide and consume public typed APIs. A native panel must actually obtain its data, actions and lifecycle through those APIs and be replaceable through provider selection. Passing manifest or wrapper tests is insufficient. Files is the first vertical slice; tree/read/navigation alone is explicitly not full Files parity. Editing, media, annotations, external open and resource invalidation remain required before retiring the original Files implementation. Other panels retain their complete behavior inventories.

## Portable contracts before implementation

Add package format 2, preserving format 1 and the existing surface manifest/view record version. Format 2 adds required bounded arrays:

- dependencies: {pluginId, versionRange, apis: [{id, versionRange}]}.
- provides: {id, version, methods: [{name, inputSchema, outputSchema, effect: read | write, requiredGrants: string[]}]}.
- requires: {id, versionRange}[].

One version per provided API ID per selected package. Own APIs are under the providing plugin's namespace. Shared t3 catalogue API descriptors must exactly match host-owned schemas/effects/grants; plugins cannot weaken a shared contract. Strict bounded draft-7 JSON schemas validate both requests and results. Full semver resolution uses a direct pinned semver dependency, with explicit prerelease semantics; installation never fetches dependency code automatically.

Server definitions expose APIs separately from model tools: apis: [{id, methods: [{name, invoke(input, session)}]}]. Existing tools remain compatible. The same authenticated session offers invokeApi(request) for declared dependencies and generic requirements. API dispatch is not a fake model tool or arbitrary host-command passthrough.

An invocation identifies API ID, version range, method, JSON input, scoped context, optional expected provider generation and request identity. Public SDK typed bindings map method names to input/output types; portable descriptor schemas remain the runtime contract. Discovery returns provider identity, contract version, generation, health, selection and explicit unavailable reason. Registration is never a grant.

## Resolution, selection and transactions

Use a pure deterministic resolver over installation snapshots, host providers, explicit selection policy and health. Sort by code-unit order, include explicit plugin and selected API-provider edges, detect complete strongly connected components, propagate unavailable dependencies and derive dependency-first activation order. Reject invalid ranges and duplicates before graph mutation. Missing, incompatible, disabled, cyclic, unhealthy and ambiguous providers produce distinct bounded reasons.

Persist explicit provider selection and an ordered fallback list by API and environment; project overrides may be added without changing identity. Multiple eligible providers never choose a winner by registration order. An unavailable explicit selection stays unavailable unless an administrator has configured fallback. Never replay a failed write on another provider. Resource identities and saved state survive unavailable providers; opaque state is never transferred to a different provider.

Stage schemas, content and executable registration handshake before publishing a replacement. No service authority is available during startup handshake. Publish each plugin's contributions atomically; unavailable plugins expose no working tool/API/surface. Recompute reverse dependents and abort affected generations on disable, remove, update, selection and rollback. Preserve previous immutable package metadata/content for explicit rollback. Rollback preserves current grants and revalidates current dependencies; it does not restore revoked authority or undo external side effects. Restart derives availability from durable records instead of assuming enabled means ready.

## Host authority and isolation

The authenticated transport supplies the root caller. Worker identity supplies the immediate plugin caller; plugins never provide their own authoritative principal. Every call checks declaration, both caller grant sets, environment/project/thread membership and current workspace revision. A provider cannot lend its ambient host grants to a consumer. Capture root/immediate caller, provider, installation/grant generations and scope at dispatch; check again after async authorization and before delivering results. Cancellation follows the call chain and nested deadlines cannot exceed the root deadline. Bound recursion, concurrency, payloads, schema complexity and result size.

Host adapters own destructive-operation authorization, approvals, idempotency, resource leases and typed receipts. Discovery advertises unsupported operations honestly. Audit only bounded identities, method, scope, outcome and receipt references, never file contents or secrets. Write cancellation means stop/suppress delivery where possible, not proof that a physical operation was rolled back.

The current code model remains trusted Node and trusted client JavaScript, not a sandbox. Broker authority checks do not revoke ambient Node filesystem/network access or isolate code sharing the app's renderer realm. Independently secure untrusted-client attribution requires an isolated renderer/worker transport; do not claim that a callback closure or public plugin ID establishes such a boundary.

## Shared catalogue

The catalogue is data and typed public contracts; the broker has no feature switch. Domain adapters necessarily own domain semantics. Initial implementations are explicitly marked; listing a contract is not advertising a functioning provider.

| Contract family            | Required operations and authority                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| workspace/files            | paginated deterministic entries, bounded reads, revision-aware writes, resource resolution                                      |
| file presentation / diff   | open/reveal file, compare versioned resources, diff data and presentation                                                       |
| URLs / browser             | checked open URL, browser session acquire/navigate/history/reload, frame/input stream, annotations, leases                      |
| surfaces                   | open/close/activate/discover, scoped host-generated handles, close protection, provider-independent resource identity           |
| notifications / clipboard  | bounded notices, supported clipboard reads/writes with client/user-gesture policy                                               |
| composer / messages        | explicit context selection/insertion/removal, readable snapshots, targeted enrichment without rewriting immutable message truth |
| resource/session lifecycle | acquire/attach/release/subscribe, cursor/backpressure, lease ownership, restart and reconnect receipts                          |
| orchestration              | agent/session/thread status and navigation, authorized start/settle/cancel, approvals, checkpoints, command/settlement receipts |
| harness/providers          | connected provider discovery, supported operations, physical-session capabilities and limitations                               |
| terminal                   | PTY create/attach/input/resize/output/replay/close, ownership independent of view visibility                                    |
| source control             | repository/status/refs/diff and authorized mutations, pluggable backend driver identity                                         |

V1 and V2 implement adapters for the same capability model. Unsupported V2 commands remain unavailable until implemented; run/attempt/session/checkpoint identities are not blindly aliased. Environment/resource identity never embeds hostnames, ports or relay origins. React Native and SwiftUI need separate renderer hosts; their absence remains explicit.

## Implementation order and evidence

1. SDK format-2 contracts, typed client bindings and initial shared workspace/file-presentation descriptors; deterministic graph resolver and independent packed consumer tests.
2. Runtime broker and transactional dependency lifecycle: provider selection, schema checks, caller chain, generations, health, cancellation, snapshots and rollback. Real worker provider + separate consumer packages, missing/conflict/cycle/revocation/crash/update/rollback tests.
3. Authenticated API discovery/invoke/selection/availability endpoints. Host workspace list/read adapters use existing project/thread authority and actual filesystem services, never caller cwd. Preserve format-1 read behavior.
4. Independently packaged Files renderer consumes public workspace APIs and provides file presentation; a second package consumes its namespaced API. Generic selected-presentation routing replaces the ordinary Files entry point. Refactor the retained Files consumer's reads/listing onto the same public contracts. No private React bindings in the installed package.
5. Real lxso2 installed-path proof: install both packages, select provider, open ordinary Files entry, navigate/read known files, show API trace, preserve state across reload/restart, then disable/revoke/update/rollback with explicit unavailable/fallback behavior. Preserve baseline967210 and existing comparisons. Do not call a read-only slice full Files replacement.
6. Complete Files parity, then terminal/browser/diff/source-control/agents with one independently owned migration task each, shared streaming/resource primitives and V1 orchestration adapters. Expand exact parity and failure evidence before retiring each built-in.

Tests must cover independent tarballs without private imports, range compatibility and shuffled graph determinism, selected-provider cycles/conflicts, no half-published activation, caller/provider revocation during async work, stale responses, output validation, unaffected plugins after failure, rollback and durable selection. Real UI tests require content and transport evidence. All implementation, builds and test clients run on lxso2 under the existing heavy-check lock; no Mac builds or browser control.
