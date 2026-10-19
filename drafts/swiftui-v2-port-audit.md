# Wire-protocol compatibility audit: SwiftUI T3 Code app vs orchestrator v2

Date: 2026-08-23. Ground truth: live orchestrator-v2 server (branch `t3code/codex-turn-mapping`, PR #2829 head 2d623ac6b) serving a snapshot of real data (553 threads / 33 projects), serverVersion 0.0.33, shell `schemaVersion: 2`. Swift app: `apps/swift-ios` at `upstream/t3code/rebuild-mobile-app-swift` (82b2dad18, build 34). Static contract diff plus live wire captures (`/tmp/v2-wire-shell.json`, `/tmp/v2-wire-thread.json`); no simulator run (no Xcode on this machine).

**Bottom line: the app connects and authenticates fine, and every non-orchestration surface (config, providers/models, PRs, VCS, terminal, files, usage) still works, but all four orchestration wire surfaces changed shape, so every thread-related screen breaks. Read paths fail silently (connected-but-empty UI with retry loops); write paths fail loudly (rejected commands). The port is bounded: one decode layer, one reducer rewrite, one command mapping table. Rough estimate 2-3 weeks single-track.**

## RPC inventory

Compatible as-is (contracts byte-identical or verified live): `server.probe/getConfig/getUsageSummary`, `subscribeServerConfig`, all 14 `pullRequests.*`, `projects.listEntries/searchEntries/readFile/writeFile`, `filesystem.browse`, `assets.createUrl`, `server.discoverSourceControl`, `sourceControl.*`, `subscribeVcsStatus`, `vcs.*`, `git.runStackedAction`, `review.getDiffPreview/getDiffFileContents`, all `terminal.*` plus its subscriptions. Providers/models decode verified live end to end (`Core/ServerConfigModels.swift:163-204`).

Same name, changed contract (v2 server registers only v2 handlers; `apps/server/src/ws.ts:1083-1272`):

- `orchestration.dispatchCommand`: command union replaced (orchestrationV2.ts:1956-2258). Live-recorded rejection of v1 `thread.turn.start`: WS Exit Failure cause `[{"_tag":"Die","defect":"Expected { type: thread.create, ... } | ..."}]`, surfaced as `RPCError.remote` (`Core/WebSocketRPC.swift:578-596`).
- `orchestration.subscribeShell`: v2 snapshot shape; delta kinds renamed v1 `project-upserted/thread-upserted/...` to `project.updated/thread.updated/...` with added `location: "active"|"archive"`. Input (`afterSequence`) still accepted.
- `orchestration.subscribeThread`: v1 `{kind:"snapshot", snapshot:{snapshotSequence, thread, page}}` / `{kind:"event", event}` (sequence inside event) became `{kind:"snapshot", snapshotSequence, projection}` / `{kind:"event", sequence, event}` with a new event union (orchestrationV2.ts:1086-1216).
- `orchestration.getArchivedShellSnapshot`: returns `{schemaVersion, snapshotSequence, projects, threads}`, no `updatedAt`.

New v2 methods the port wants: `orchestration.launchThread` (input 2322-2342), `getThreadProjection`, `subscribeArchivedShell`, `getTurnDiff`, `getFullThreadDiff`, `searchThreads`, `assets.persistChatAttachments`.

Command matrix (Swift `OrchestrationCommands`, `T3Client.swift:1479-1812`; v2 ignores excess properties, verified live):

| Swift command | v2 verdict |
|---|---|
| thread.archive/unarchive, thread.delete, thread.settle/unsettle, thread.snooze/unsnooze, thread.pin/unpin | Accepted |
| thread.runtime-mode.set, thread.interaction-mode.set | Accepted |
| thread.turn.start | Rejected; v2 is `message.dispatch` (needs createdBy, creationSource, dispatchMode, persisted ChatAttachments) or `launchThread` for bootstrap |
| thread.create | Rejected: v2 requires createdBy+creationSource |
| project.create | Rejected: no project commands in v2 union; use `projects.mutate` / `POST /api/projects/mutate` |
| thread.meta.update (rename/regenerate) | Rejected: v2 name is `thread.metadata.update` |
| thread.turn.interrupt (turnId) | Rejected: v2 is `run.interrupt` (runId) |
| thread.approval.respond / thread.user-input.respond | Rejected: v2 is `runtime-request.respond` (decision literals unchanged) |

HTTP: `/.well-known/t3/environment` OK; `POST /api/pull-requests/diff` OK; auth endpoints OK. `GET /api/orchestration/shell` and `/threads/:id` return 200 but undecodable v2 bodies (paging moved to `/bounded` + `/history`); `GET /api/orchestration/snapshot` and `POST /api/orchestration/dispatch` are 404 (the disconnected-WS dispatch fallback `T3Client.swift:367-378` is dead on v2).

## Decode surface

- `OrchestrationShellSnapshot` (`Models.swift:484-489`): required `updatedAt` absent in v2, whole decode throws.
- `OrchestrationThreadShell` (`Models.swift:386-410`): required `hasPendingApprovals`/`hasPendingUserInput` absent; v2 replacements are `latestRunId/latestRun*/activeRunId/activityRunStatus/status/lastError/pendingRuntimeRequest/latestVisibleMessage/itemCount/visibleItemCount`.
- `OrchestrationProject` (`Models.swift:337-347`): compatible, the one v1 struct that survives.
- `OrchestrationThreadDetailSnapshot` (`Models.swift:498-512`): requires `thread`, v2 sends `projection` (thread, runs, attempts, nodes, subagents, providerSessions/Threads/Turns, runtimeRequests, messages, plans, turnItems, checkpointScopes, checkpoints, contextHandoffs, contextTransfers, visibleTurnItems, updatedAt).
- `OrchestrationMessage` (`Models.swift:412-421`): nearly reusable; v2 ConversationMessage carries all required fields; `ChatAttachment` matches byte for byte.
- `OrchestrationActivity` (`Models.swift:431-440`): no v2 counterpart; timeline is now 21 typed turn-item kinds wrapped as `{position, visibility, sourceThreadId, sourceItemId, item}`.
- Checkpoint/session/latestTurn: renamed vocabulary (ref, ordinalWithinScope, capturedAt; Run status literals grew: preparing/queued/starting/waiting/cancelled/rolled_back).
- Stream item enums are lenient (`ShellStreamItem` unknown -> `.refreshRequired`, `ThreadStreamItem` -> `.event(.null)`), which is exactly why the failure is silent.
- Runtime requests: v2 has first-class `RuntimeRequest` records + `approval_request`/`user_input_request` turn items + shell-level `pendingRuntimeRequest`.

## Failure modes per screen

- Environment home + thread list: silently empty (decode error swallowed by `try?` at `NativeFeatureClient.swift:3308-3311`); stream connects, every item collapses to `.refreshRequired`, recovery re-fails; UI claims connected while showing nothing.
- Archived threads: silently empty.
- Thread detail: perpetual empty with a hot retry loop (reducer guard `NativeFeatureClient.swift:5667-5678` returns -1, forces doomed HTTP refresh; 2s polling re-fails).
- Live streaming: all v2 event types fail the reducer guard (sequence moved to wrapper).
- Composer dispatch: loud failure, raw schema-expectation text as the error message; new-thread bootstrap rejected.
- Approvals: invisible AND unanswerable; threads stall in waiting.
- Provider/model picker: works. PRs, terminal, VCS, files, usage: work.
- No crashes anywhere.

## Porting checklist (ordered)

Protocol switch hook: `schemaVersion` in the v2 shell snapshot (live value 2, never present in v1); decode with `decodeIfPresent`, gate on `>= 2`, keep the v1 path per environment. Secondary probe: 404 on `/api/orchestration/snapshot`.

1. Version detection + adapter seam (S, ~1 day): protocol enum per environment, orchestration calls routed through protocol adapters behind `T3Client`.
2. v2 shell decode + thread mapping (M, 2-3 days): new Codables + four renamed delta kinds; rework `mapThread`/`resolveThreadState` (`NativeFeatureClient.swift:4022-4085`) onto status/activityRunStatus/pendingRuntimeRequest/latestVisibleMessage/latestRunStartedAt/lastError.
3. Thread detail: projection + visibleTurnItems (L, ~1 week, the bulk): per-element lossy decode (reuse `ForwardCompatibleArray`); ship user_message/assistant_message/reasoning/error/command_execution/file_change/todo_list first, generic row for the rest; paging via `/bounded` + `/history`.
4. Thread stream reducer rewrite (M, 2-3 days): consume `{kind:"event", sequence, event}`; reduce message.updated, turn-item.updated, run.updated, runtime-request.updated, checkpoint.captured, thread.* metadata; unknown -> existing refresh path.
5. Command mapping table (M, 2-3 days): turn.start -> message.dispatch (createdBy user, creationSource mobile, dispatchMode start_immediately / queue_after_active when activeRunId set); bootstrap -> launchThread; interrupt -> run.interrupt via activeRunId; approval/input -> runtime-request.respond; rename -> thread.metadata.update; project.create -> projects.mutate; attachments via assets.persistChatAttachments; delete HTTP dispatch fallback on v2.
6. Runtime request sourcing (S-M, 1-2 days): projection.runtimeRequests pending + request turn items; shell badge from pendingRuntimeRequest.
7. Fixtures + tests (S, ~1 day): v2 wire fixtures beside v1 in `Tests/CoreTests/WireFixtureContractTests.swift`; live captures are ready-made seeds.

Untouched: pairing, auth/tickets/DPoP, config/providers, PRs, VCS/git, terminal, review, files, assets, usage.

Churn flags (open PR stack; isolate behind the adapter, decode leniently): delegatedCompletion/completionWake, pendingBackgroundTasks, pinOrderKey + thread.pin.reorder, thread.visit/mark-unread, handoff model fields, progressive-history optionalKey fields, historyOrigin "v1_import". Turn-item and event unions are designed to grow; per-element lossy decoding of both is mandatory. Re-verify against the merged PR before shipping.
