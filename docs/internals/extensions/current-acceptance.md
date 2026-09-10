# What the extension system currently proves

This is an acceptance record, not a completion announcement. The latest bounded slice is the [installed native Files tree source](../../../packages/extension-sdk/examples/native-files-tree/README.md) and its [dated proof receipt](../../../packages/extension-sdk/examples/native-files-tree/proof.json), in /home/saphid/projects/t3-extensions-authoring on lxso2. Earlier [read-only authority](read-api-authority-evidence.md), [upstream integration](upstream-integration-evidence.md), [terminal output](terminal-output-events-evidence.md), and [package asset](package-assets-evidence.md) receipts retain their own scope.

## Plain-English status

An installed plugin can define its own API, call another installed plugin or an authorized host API, and render its own view. The ordinary Files entry can use an installed read-only implementation, including with a read-only login. Independently installed Terminal examples inspect existing sessions and consume bounded snapshots/live output. WASM/font assets can be verified and loaded through public package APIs.

Those paths work. Full replacements for all six built-in panels are not built.

The native-tree slice independently packages the same Pierre tree engine and consumes a finite public native-index snapshot plus public file reads through the ordinary Files entry. Seven installed checks, 23 focused host tests, 49 SDK tests, and scoped lint/typecheck pass. Ordinary React/JSX dependency imports now share host React through the SDK CLI. Automatic workspace mutation refresh, composer actions, theme/icon fidelity, full Files preview/editing and performance parity remain unproven; React DOM imports remain unsupported.

| Surface         | Proven installed behavior                                                                                                                                        | Remaining replacement work                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files           | Ordinary entry uses public presentation/workspace APIs; exact text and selected file survive reload, including with only orchestration:read authority.           | Editing/save recovery, full tree/media/Markdown/comments/attachments/editor actions and large-file parity.                                                                        |
| Diff            | Existing native panel remains available.                                                                                                                         | Public data/renderer contracts and independent installed replacement.                                                                                                             |
| Version Control | Upstream linked-PR list remains integrated through the native extension bridge; empty-list/reload path tested.                                                   | Public source-control/review operations, receipts and independent renderer; current bridge is privileged. Populated GitHub/GHE parity is not established by the empty-list proof. |
| Browser         | Existing native panel remains available.                                                                                                                         | Public browser/native-engine resources, ownership, lifecycle and installed renderer parity.                                                                                       |
| Terminal        | Installed status, output snapshots and bounded live-output diagnostic consumers use public APIs. Real renderer assets load through public verified-asset access. | Interactive open/input/resize/restart/close, complete VT renderer, durable selection/resource continuity and sustained-output parity. The native Terminal remains a wrapper.      |
| Agents          | Existing native panel remains available; source audit and candidate migration slices are documented in retained trial artifacts.                                 | Public roster/workflow/script adapters and independent renderer. The transport prerequisite is fixed; the Agents migration itself is not implemented.                             |

## Framework and authority

Dependency/version requirements, deterministic provider selection, grants, lifecycle, unavailable states and installed update/rollback/uninstall paths have focused tests and independent consumer examples. The shared catalogue currently keeps one exact definition per API ID; general simultaneous multi-version retention is not implemented.

Installed stream provider/consumer examples survive ordinary open/close, revocation, dependency changes and replacement. Their counters reset after server restart. Installations, grants, package hashes and view restoration are durable independently of a plugin's domain state; the examples do not prove arbitrary durable domain resources.

Authenticated HTTP/WS calls retain root identity through nested plugins. Read-only HTTP sessions can invoke read methods, while writes retain access:write authority and independent domain/plugin grants. Revocation and stale-result suppression are proven, including a real pending installed handler and a silent stream. Native Terminal APIs also require the login's terminal permission. Legacy tool/MCP roots and the model-facing typed API front door remain incomplete.

Verified format-4 assets support bounded WASM/font/binary delivery and client lifetime/hash checks. The [renderer-assets trial](renderer-assets-trial.md) loads actual Ghostty WASM and font assets; this is not complete terminal-renderer parity. [Composer context and message decorations](architecture.md) retain their documented synchronous, read-only/snapshot limitations.

## Evidence and remaining limits

Canonical artifact root: /home/saphid/artifacts/t3-extensions-health-rounds-20260909. Use each linked evidence document's exact final receipts, source/package identity and scope; do not add test counts from different checkpoints into one supposed full-suite result.

The read-authority slice has 11 HTTP/session tests, nine root tests, one focused nested-worker case, scoped typecheck/lint, a production build and eight real installed-path checks. Earlier terminal/assets/upstream evidence retains its own broader checks and baseline comparisons. Small local timing measurements do not establish full interactive performance or relay/tunnel throughput.

Luna builder/monitor pairs found useful defects, but source checks, visual inspection, exact process exits and parent judgment remained necessary. Repeated stale reports, wrong artifact/lock paths and proof assumptions are recorded in trial notes. A completed worker turn alone is not acceptance. Direct Claude Opus 5 high attempts failed OAuth before any reviewer model ran; no Claude review is claimed.

React Native mobile, SwiftUI mobile, Electron packaging, native Windows/macOS engines, remote/relay/tunnel modes, complete durable resource identity and Orchestra V2 execution require separate proof. No PR, push or deployment has been made for these checkpoints.
