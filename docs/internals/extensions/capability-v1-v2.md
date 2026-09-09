# Capability compatibility across V1 and V2

Status: source audit and proposed adapter plan, 2026-09-09. No V2 runtime was started, no branch was checked out, and no V2 tests were run. Public orchestration APIs described below are **proposed**, not registered capabilities.

The portable extension API model can stay the same across V1 and V2. Scope lookup, orchestration commands, execution identities, request routing and checkpoint operations need backend-specific adapters. Do not translate V2 into a complete V1 projection or treat V1 turns as interchangeable with V2 runs and attempts.

## Exact sources inspected

All inspection took place in /home/saphid/projects/t3-extensions-integration on lxso2 through working-tree reads and read-only git show / git ls-tree.

| Reference                                                              | Exact commit                             | Evidence and limitation                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 integration branch feat/extensions-capabilities-20260909            | e3a01654f4069aea6de922b7319c7865ea8420ba | Current V1 service/contract baseline. Capability changes were uncommitted working-tree changes during inspection, not claimed to be in this commit.                                                                 |
| V2 implementation reference origin/t3code/orchestration-v2-audit-fixes | 269e5a8f89300020052b2261809b5dd9b2b87d64 | Contains apps/server/src/orchestration-v2, packages/contracts/src/orchestrationV2.ts, and docs/orchestration-v2. Commit date: 2026-07-12. Historical implementation, not evidence of deployment or latest upstream. |
| Newer branch repair/d6096318-integration-final-v2                      | 25efbfad3e419ab22b7d3f78b37a6b5ade7660b4 | Its inspected server/contracts tree uses the current orchestration layout, without orchestration-v2. Branch name alone is not V2 evidence.                                                                          |
| Newer branch fork/work/v2-main-sync-20260905                           | f0b64d0c7b3d23bc12be8333628fdb62e0fff52c | Its inspected tree likewise does not provide the separate V2 implementation used here.                                                                                                                              |

Working-tree Git blob hashes captured for the new public layer:

- packages/extension-sdk/src/catalogue.ts: 7df143eb31cf5dacd5a961cbed96d477345cce1f.
- apps/server/src/extensions/workspaceApi.ts: 4f06443ab38eabc5ca73b96c3fcce5cf6abb6c7d.
- docs/internals/extensions/capability-system.md: bcd3000e93c3bccdef12b411565d7f69dd9fd187.

These identify inspected content, not commits or publication. All V2 paths below refer to the exact V2 commit above; all V1 paths refer to the integration worktree.

V2 design sources:

- .plans/21-orchestration-v2-application-integration.md: V2 replaces agent orchestration; projects/threads remain application aggregates with one ordered event source. It prohibits dual writing and a full server-side V2-to-V1 compatibility projection.
- docs/orchestration-v2/entity-ids-and-correlation.md: app IDs are identity; native provider IDs are scoped correlation evidence.
- docs/orchestration-v2/provider-capability-system.md: provider capabilities describe supported behavior, with separate policy decisions.
- apps/server/src/orchestration-v2/TODO.md and .plans/22-orchestration-v2-audit-remediation.md: contain incomplete projection, lifecycle and provider work. Their historical validation claims were not rerun here.

## What is public now

The inspected SDK catalogue defines two APIs at version 1.0.0 in packages/extension-sdk/src/catalogue.ts:

| API ID                                | Methods and authority                                                                                                                                           | Implementation status                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| t3.workspace/files                    | listEntries({relativePath,cursor?,limit?}) requires t3.workspace/list-entries; readText({relativePath}) requires t3.workspace/read-text. Both effects are read. | V1 host provider host.workspace, from makeWorkspaceApiProvider in apps/server/src/extensions/workspaceApi.ts.      |
| t3.file/presentation                  | open({relativePath}) requires t3.file/open, effect read; returns surface ID, placement and restore state.                                                       | Public descriptor plus selected provider/renderer integration; not evidence of a V2 renderer or full Files parity. |
| Legacy service t3.workspace/read-text | Format-1 bounded read service.                                                                                                                                  | Retained in apps/server/src/extensions/EnvironmentExtensions.ts; distinct from format-2 API ID t3.workspace/files. |

No orchestration, checkpoint, approval or agent-control API is registered in that catalogue. Internal services and existing transport operations do not automatically become extension grants.

The V1 workspace adapter obtains project/thread membership and worktree location from ProjectionProjectRepository and ProjectionThreadRepository via extensions/scope.ts; callers cannot supply cwd. It rechecks scope after asynchronous work. Pages fit the 64KiB JSON budget, paths are bounded to 512 characters, scans fail above 10,000 entries, and symlinks/unrepresentable names are omitted. Reads are bounded previews, not content revisions or editable full documents.

## Stable boundaries and adapter changes

| Boundary                   | Stable contract                                                                                                                            | V1 implementation                                                                                      | V2 adapter change                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package and broker         | Format-2 dependencies/provides/requires, ranges, schemas, selection/fallback, generations, cancellation and caller checks                  | packages/extension-sdk/src/capabilities.ts; packages/extension-runtime/src/broker.ts and resolution.ts | Reuse this model. The historical V2 branch does not contain this integrated extension capability host.                                                                                                                                 |
| Environment/resource scope | Host-authenticated environment/project/thread identity and current workspace revision; no caller cwd or network origin in durable identity | extensions/scope.ts reads V1 repositories                                                              | Keep project identity; use ThreadManagementService.getProjectThread or the authoritative V2 projection. Validate thread.projectId, worktreePath and deletedAt before and after work. Do not authorize through a stale V1 thread table. |
| Workspace                  | Same public list/read semantics and confinement                                                                                            | WorkspacePaths, WorkspaceFileSystem and scope resolver                                                 | Filesystem logic can remain; scope lookup/wiring changes. V2 ws.ts still has project list/read/write transport methods, but these broader operations are not substitutes for an extension grant.                                       |
| Status                     | Small scoped snapshot, explicit execution type, cursor and availability                                                                    | ProjectionSnapshotQuery.getThreadShellById/getThreadRuntimeContext/getThreadDetailSnapshot             | Read ThreadManagementService / ProjectionStoreV2 and retain distinct run, attempt, provider-session and pending-request references. Do not hydrate an entire graph for a badge.                                                        |
| Provider selection         | ProviderInstanceId routes a configured instance; ProviderDriverKind identifies the implementation; ModelSelection is instance-based        | packages/contracts/src/providerInstance.ts and model selection                                         | Keep the distinction. V2 provider capability records constrain supported behavior; they do not authorize a plugin.                                                                                                                     |
| Clients                    | Generic API invocation and resource identity                                                                                               | Web/desktop integration in this work                                                                   | Rebind lifecycle/state to V2 projections. React Native and SwiftUI require separate renderer hosts and verification.                                                                                                                   |

Exact internal Effect service IDs are implementation details, not public API IDs:

| V1 service ID                                                                              | V2 service ID / destination                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| t3/orchestration/Services/OrchestrationEngine/OrchestrationEngineService                   | t3/orchestration-v2/Orchestrator/OrchestratorV2; application helper t3/orchestration-v2/ThreadManagementService                                |
| t3/orchestration/Services/ProjectionSnapshotQuery                                          | Thread data: t3/orchestration-v2/ProjectionStore/ProjectionStoreV2; application project/shell data remains separately owned                    |
| t3/persistence/Services/OrchestrationCommandReceipts/OrchestrationCommandReceiptRepository | t3/orchestration-v2/CommandReceiptStore/CommandReceiptStoreV2, which adapts application receipt persistence                                    |
| t3/orchestration/Services/RuntimeReceiptBus                                                | No public equivalent established here. V2 stored events, checkpoints and RunFinalizationService can back a new durable public receipt adapter. |

Sources: V1 apps/server/src/orchestration/Services/{OrchestrationEngine,ProjectionSnapshotQuery,RuntimeReceiptBus}.ts and persistence/Services/OrchestrationCommandReceipts.ts; V2 apps/server/src/orchestration-v2/{Orchestrator,ThreadManagementService,ProjectionStore,CommandReceiptStore,RunFinalizationService}.ts.

## Minimum orchestration contract to design next

Proposed family: t3.orchestration/threads. Method names below are design labels, not registered IDs. Keep read, start, interruption, settlement, approval response and checkpoint rollback separately granted. Do not expose arbitrary command dispatch.

| Proposed operation            | V1 mapping                                                                                                                    | V2 mapping and limits                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| status                        | Scoped projection; keep thread settlement separate from provider activity                                                     | Scoped projection with RunId, RunAttemptId, ProviderSessionId, RuntimeRequestId and terminal status. Bounded summaries only.                                                                                                   |
| start                         | Normalize and dispatch thread.turn.start with CommandId, ThreadId, user message, model/modes and timestamp                    | ThreadManagementService.sendToThread / message.dispatch; explicit start/queue/steer/restart policy; returns delivery and RunId. New-thread/worktree launch uses ThreadLaunchService, not guessed setup.                        |
| settle / unsettle             | thread.settle and thread.unsettle; latter carries reason:user. Session-stop cleanup is separately guarded.                    | **Unavailable at the inspected V2 SHA.** The complete command union contains neither, and its app-thread schema has no equivalent settlement fields. Completion, archive, session detach and interruption are not substitutes. |
| cancel                        | thread.turn.interrupt with validated optional TurnId. thread.session.stop is a different operation.                           | ThreadManagementService.interruptThread / run.interrupt with RunId; distinguish requested, no-active-run and already-terminal. Acceptance is not provider termination. Specify queued versus active behavior.                  |
| listRequests / respond        | Pending approval/user-input projection; thread.approval.respond and thread.user-input.respond use ApprovalRequestId           | runtime-request.respond uses RuntimeRequestId. RuntimeRequestServiceV2 checks the recorded live provider session and rejects non-resumable requests. Native callback IDs are not public identities.                            |
| checkpoints / rollback        | Projected checkpoint context and thread.checkpoint.revert targeting a turn count; CheckpointRef remains internal              | CheckpointScopeId + CheckpointId; checkpoint.rollback restores filesystem/provider context through V2 services. Preserve scoped lineage/stale state; never guess a checkpoint from a count.                                    |
| receipt / scoped subscription | Durable command receipt: accepted/rejected, resultSequence and error. RuntimeReceiptBus milestones are test-only/short-lived. | CommandReceiptStoreV2 supplies accepted/rejected; stored events and RunFinalizationService describe later outcomes. Define bounded durable milestones and resumable cursors for both adapters.                                 |

Command/schema evidence: V1 packages/contracts/src/orchestration.ts; V2 packages/contracts/src/orchestrationV2.ts. Behavior evidence: V2 ThreadManagementService.ts, RuntimeRequestService.ts, CheckpointService.ts and CheckpointRollbackService.ts.

A V1 turn is not a provider session. A V2 counted run can have multiple attempts, with reasons initial, steering_restart, retry or provider_recovery; attempts can refer to provider turns. Use tagged public execution references with opaque IDs. Cross-version identity equivalence requires a migration receipt.

Distinguish command accepted, execution terminal and side effects finalized. V1 dispatch returns a persisted sequence, not completion. RuntimeReceiptBus exposes checkpoint.baseline.captured, checkpoint.diff.finalized and turn.processing.quiesced for tests only. V2 accepted receipts likewise do not prove checkpoint capture, cleanup or termination. Durable public completion receipts are new work.

## Authority and cancellation

V1 orchestration HTTP requires AuthOrchestrationReadScope for snapshots and AuthOrchestrationOperateScope for dispatch (apps/server/src/orchestration/http.ts). V2 apps/server/src/ws.ts applies the same read/operate distinction to snapshots/subscriptions and dispatch/launch. Transport scopes do not replace per-method plugin grants.

The current extension HTTP layer uses read authority for discovery and access-write authority for invocation/selection (apps/server/src/extensions/http.ts). Before exposing orchestration, explicitly decide how root orchestration read/operate authority reaches the broker. Do not infer it from the broad extension invocation gate or the provider's own grants.

Each call must independently verify authenticated root/immediate caller, declaration, method grants, installation/provider generation, environment/project/thread membership and current scope. Approval response also binds the still-pending request and its live session. Rollback requires destructive-operation policy. The adapter owns command IDs, deduplication, bounded receipts and required confirmation/approval. Never retry a failed write on another provider.

Cancellation propagates through the chain; accepted commands or physical actions may outlive response delivery. Preserve durable receipt lookup after cancellation. An AbortSignal is not rollback.

## Draft plan recommendation

1. Complete the existing Files slice and retain the full panel until saving, assets, annotations and lifecycle behavior are covered. The separate files-next-slice.md evidence recommends revision-aware text editing first.
2. Specify tagged execution/resource references and durable receipt semantics before orchestration writes. Begin with bounded status and capability discovery; prove both adapter mappings with fixtures.
3. Add V1 start/interruption, approval response and checkpoint adapters with explicit grants. Implement settlement and its reverse together, preserving command/receipt paths.
4. Port those contracts onto a deliberately chosen V2 revision using its services. Test runs versus attempts, request resumption, rollback lineage and event replay. Keep settlement unavailable until V2 implements its actual meaning.
5. Keep provider behavior capabilities distinct from extension permission grants and package provider selection.

Plain-English status: the shared capability design is compatible with both backends, but only the V1 workspace adapter is implemented in this work. Available V2 source supports an adapter plan; it is not a working V2 extension host. Settlement and durable public completion receipts still need implementation.
