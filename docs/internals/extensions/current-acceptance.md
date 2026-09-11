# What the extension system currently proves

Next work is defined in the [implementation plan](implementation-plan.md). Its proposed contracts and tasks are not implemented capabilities.

This is an acceptance record, not a completion announcement. The last accepted bounded slice is the [installed native Files tree source](../../../packages/extension-sdk/examples/native-files-tree/README.md) and its [dated proof receipt](../../../packages/extension-sdk/examples/native-files-tree/proof.json), in /home/saphid/projects/t3-extensions-authoring on lxso2. Earlier [read-only authority](read-api-authority-evidence.md), [upstream integration](upstream-integration-evidence.md), [terminal output](terminal-output-events-evidence.md), and [package asset](package-assets-evidence.md) receipts retain their own scope.

## Latest parent verdict — 2026-09-11

Repair-round-1 all-gates PASS is not accepted. Direct public-provider tests reproduced BOM loss and an orphan temporary file after actual AbortSignal cancellation (exit 1). R3 still lacks a passing scoped server compiler receipt, and an installed path-denial assertion needs strengthening. Kimi must correct these before dependent migration work. The ordinary-pairing save proof and added pre-commit authority callback remain meaningful partial progress. Exact probe, hashes and verdict: /home/saphid/artifacts/t3-files-edit-20260910/repair-round-1/parent-verification/.

## Plain-English status

An installed plugin can define its own API, call another installed plugin or an authorized host API, and render its own view. The ordinary Files entry can use an installed read-only implementation, including with a read-only login. Independently installed Terminal examples inspect existing sessions and consume bounded snapshots/live output. WASM/font assets can be verified and loaded through public package APIs.

Those paths work. Full replacements for all six built-in panels are not built.

## Parent review correction — 2026-09-10

Status: **editable-file checkpoint needs repair; manager PASS is not accepted**. The code remains an uncommitted candidate on top of 2c8b3fd86a23cf5890cb255f5202d11498bbad88. Preserve original manager reports as historical evidence.

The installed small-text editor is real: the manager recorded 10 passing API checks and 7 passing renderer checks. Focused host tests recorded 31 passes and SDK tests 56 passes (including 7 text-edit tests). These overlapping checkpoints are not an aggregate suite or full Files parity.

The parent found these acceptance gaps:

1. Before publication, the writer must recheck current caller authority, original resolved scope and cancellation. The provider currently checks authority/scope after replacement; IO has no authority callback. Suppressing a response after an unauthorized write is insufficient. Parent feedback explicitly required the pre-commit check. Keep post-commit outcome-unknown separate.
2. Successful browser Save used an administrative cookie in place of ordinary pairing. Normal paired sessions lack access:write. This blocks native editing parity. Keep installation/grant controls administrative while authorizing domain operations by host policy; do not grant ordinary users admin scope.
3. The reported typecheck counted 1383 errors through a pipeline whose final command exited zero. It did not pass. Obtain a real scoped compiler exit and run affected EnvironmentExtensions wiring tests after repairing scoped dependency resolution. No repo-wide checks.
4. Audit interruption cleanup and the per-file lock map (entries are not removed), test UTF-8 BOM round trips, and include the editable example in the SDK package file list. Verify package contents.

Next checkpoint: repair these gaps, rerun installed proof using ordinary paired credentials, and obtain independent GLM 5.3 Flash review against the frozen task before Kimi requests parent review. Parent owns acceptance.

Files replacement remains future work: extract the existing native editor/tree/preview and save coordinator through public APIs, then compare complete behavior/performance with the retained baseline. Do not substitute more miniature editors.

## Editable Files candidate (2026-09-10, checkpoint t3-files-edit-20260910)

A bounded editable-text slice on top of the native-tree work: an installed plugin (`example.editable-files` 1.0.0) reads and writes supported workspace text through the new public `t3.workspace/text-edits@1.0.0` host API. This is proven against the real installed package, not a wrapper. It does not change the table below's Files row beyond adding an explicit-save text path, and it is not the six-panel goal.

What is proven (independent manager-installed proof on isolated disposable state, server pid 2362639 / port 49165):

- Real package install with read+write grants; `readSnapshot` returns exact complete bytes plus a sha256 revision; binary, oversized and symlinked files are explicitly `not-editable`; paths outside the workspace are rejected.
- Explicit `save` writes exact bytes to disk (same-dir O_EXCL temp, fsync, atomic rename) and returns the new revision; a stale `expectedRevision` returns a conflict without touching disk; manual reread/refresh returns the new bytes.
- Save is denied under a read-only grant and also denied when the session lacks `orchestration:operate` even with `access:write` transport; read still works read-only; disk is unchanged on every denial.
- Installed renderer (browser proof): open, edit, explicit Save writes exact bytes, manual Refresh rereads, a conflicting external edit retains the on-screen draft without overwriting disk, and Refresh after conflict loads the disk winner. The paired-browser save path was exercised by upgrading the proof's own isolated context to a full-scoped session cookie, because pairing credentials never carry `access:write`; that is an unresolved plugin/native authority parity gap; ordinary-pairing Save is unproven.

Authority path: HTTP prefers `access:write` then `orchestration:read`; the broker gates writes on `allowWrite` and re-checks scope pre/post invoke; the provider independently requires `orchestration:operate` for save and `orchestration:read` for read because the broker cannot distinguish operate from read.

Identity: SDK tarball sha256 `29b7e642…`; installed contentHash `31cb868d…`; client.mjs `fc4edfde…`; manifest `c8daeb34…`. Evidence root /home/saphid/artifacts/t3-files-edit-20260910 (manager/proof-api.json 10/10, manager/proof-ui.json 7/7, manager/candidate-identity.json, reviewer/frozen-code-review.json).

Historical Kimi verdict was PASS with deviation D1. Parent rejects D1: review-feedback.md required authority/scope/signal checks before commit, separately allowing ambiguity after commit. Candidate acceptance is withdrawn until repaired. Direct Claude Opus 5 review failed with 503 auth_unavailable; no Claude review occurred.

Limits of this slice: explicit Save only (no autosave/journal), a host-enforced 24000-byte editable-text bound, UTF-8 text only, compare/rename race documented (no universal CAS), win32 rejected as unsafe-path. Cancellation/unknown outcomes surface an honest unknown and retain the draft.

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
