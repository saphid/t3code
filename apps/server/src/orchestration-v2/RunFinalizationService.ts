import {
  CheckpointScopeId,
  CommandId,
  OrchestrationV2RunFinalizationOperation,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as CheckpointCapture from "./CheckpointCaptureService.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as RunFinalized from "./RunFinalized.ts";

export class RunFinalizationError extends Schema.TaggedError<RunFinalizationError>()(
  "RunFinalizationError",
  {
    threadId: ThreadId,
    runId: RunId,
    scopeId: CheckpointScopeId,
    operation: OrchestrationV2RunFinalizationOperation,
    cause: Schema.Defect(),
  },
) {}

export class RunFinalizationRefreshError extends Schema.TaggedError<RunFinalizationRefreshError>()(
  "RunFinalizationRefreshError",
  { cwd: Schema.String, cause: Schema.Defect() },
) {}

export class RunFinalizationObserver extends Context.Reference<{
  readonly refreshAfterTurn: (projectId: ProjectId) => Effect.Effect<void>;
  readonly refresh: (input: {
    readonly cwd: string;
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) => Effect.Effect<void, RunFinalizationRefreshError>;
}>("t3/orchestration-v2/RunFinalizationObserver", {
  defaultValue: () => ({ refresh: () => Effect.void, refreshAfterTurn: () => Effect.void }),
}) {}

export class RunFinalizationService extends Context.Service<
  RunFinalizationService,
  {
    /**
     * Captures the run's checkpoint, refreshes its workspace, then records
     * `run.finalized`. At-least-once: every step is safe to repeat. When the
     * last attempt (`willRetry: false`) fails, it records
     * `run.finalization-failed` before failing.
     */
    readonly finalize: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly scopeId: CheckpointScopeId;
      readonly willRetry: boolean;
    }) => Effect.Effect<void, RunFinalizationError>;
  }
>()("t3/orchestration-v2/RunFinalizationService") {}

const make = Effect.gen(function* () {
  const checkpointCapture = yield* CheckpointCapture.CheckpointCaptureServiceV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const observer = yield* RunFinalizationObserver;

  const recordFailure = (error: RunFinalizationError) =>
    Effect.gen(function* () {
      const { run } = yield* projections.getCheckpointCaptureContext(error.threadId, error);
      // A rolled-back run was discarded; there is nothing to report.
      if (run === undefined || run.status === "rolled_back") return;
      // EventSink drops the event when this run already recorded its finalization.
      yield* eventSink.write({
        commandId: CommandId.make(`command:effect:run.finalization-failed:${run.id}`),
        events: [
          RunFinalized.makeRunFinalizationFailedEvent({
            run,
            operation: error.operation,
            occurredAt: yield* DateTime.now,
          }),
        ],
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to record run finalization failure", {
          threadId: error.threadId,
          runId: error.runId,
          cause,
        }),
      ),
    );

  const runSteps = Effect.fn("RunFinalizationService.finalize")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly scopeId: CheckpointScopeId;
  }) {
    yield* checkpointCapture
      .execute(input)
      .pipe(
        Effect.mapError(
          (cause) => new RunFinalizationError({ ...input, operation: "capture-checkpoint", cause }),
        ),
      );
    const projection = yield* projections
      .getCheckpointContext(input.threadId)
      .pipe(
        Effect.mapError(
          (cause) => new RunFinalizationError({ ...input, operation: "refresh-workspace", cause }),
        ),
      );
    const cwd = projection.checkpointScopes.find((scope) => scope.id === input.scopeId)?.cwd;
    if (cwd !== undefined) {
      yield* observer
        .refresh({ cwd, threadId: input.threadId, runId: input.runId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new RunFinalizationError({ ...input, operation: "refresh-workspace", cause }),
          ),
        );
    }
    yield* Effect.gen(function* () {
      const { run } = yield* projections.getCheckpointCaptureContext(input.threadId, input);
      // A rolled-back run was discarded before its capture ran.
      const outcome = run === undefined ? null : RunFinalized.runFinalizedOutcome(run.status);
      if (run === undefined || outcome === null) return;
      // EventSink drops the event when this run already recorded its finalization.
      yield* eventSink.write({
        commandId: CommandId.make(`command:effect:run.finalized:${run.id}`),
        events: [
          RunFinalized.makeRunFinalizedEvent({ run, outcome, occurredAt: yield* DateTime.now }),
        ],
      });
    }).pipe(
      Effect.mapError(
        (cause) => new RunFinalizationError({ ...input, operation: "record-finalized", cause }),
      ),
    );
  });

  const finalize: RunFinalizationService["Service"]["finalize"] = ({ willRetry, ...input }) =>
    runSteps(input).pipe(
      Effect.tapError((error) => (willRetry ? Effect.void : recordFailure(error))),
    );
  return RunFinalizationService.of({ finalize });
});

export const layer = Layer.effect(RunFinalizationService, make);

export const observerLive = Layer.effect(
  RunFinalizationObserver,
  Effect.gen(function* () {
    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
    const vcsStatus = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const pullRequests = yield* PullRequestService.PullRequestService;
    return {
      refreshAfterTurn: pullRequests.refreshAfterTurn,
      refresh: ({ cwd, threadId, runId }) =>
        Effect.gen(function* () {
          const [, local] = yield* Effect.all(
            [workspaceEntries.refresh(cwd), vcsStatus.refreshLocalStatus(cwd)],
            { concurrency: "unbounded" },
          );
          if (local.refName === null || local.isDefaultRef) return;
          const thread = yield* projections.getThreadShell(threadId);
          if (!thread || thread.branch !== local.refName) return;
          if (thread.activeRunId !== null && thread.activeRunId !== runId) return;
          yield* vcsStatus.refreshPullRequestStatus(cwd).pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to refresh pull request status after run completion", {
                threadId,
                cwd,
                detail: error.message,
              }),
            ),
          );
        }).pipe(Effect.mapError((cause) => new RunFinalizationRefreshError({ cwd, cause }))),
    };
  }),
);
