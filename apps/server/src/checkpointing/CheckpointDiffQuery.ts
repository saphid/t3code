/**
 * CheckpointDiffQuery - Query interface for computed checkpoint diffs.
 *
 * Provides read-only diff operations across checkpoint snapshots used by
 * orchestration APIs.
 *
 * @module CheckpointDiffQuery
 */
import {
  type CheckpointRef,
  type CheckpointLineage,
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffInput,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  CheckpointDiffResultInvalidError,
  CheckpointThreadNotFoundError,
  CheckpointTurnRangeUnavailableError,
} from "./Errors.ts";
import type { CheckpointServiceError } from "./Errors.ts";
import {
  checkpointBaselineRefForThreadTurn,
  checkpointLineageBaselineRefForThreadTurn,
  checkpointRefForThreadTurn,
} from "./Utils.ts";
import * as CheckpointStore from "./CheckpointStore.ts";

/** Service tag for checkpoint diff queries. */
export class CheckpointDiffQuery extends Context.Service<
  CheckpointDiffQuery,
  {
    /**
     * Read the patch diff for a single turn checkpoint transition.
     *
     * Verifies checkpoint availability in both projection state and filesystem.
     */
    readonly getTurnDiff: (
      input: OrchestrationGetTurnDiffInput,
    ) => Effect.Effect<OrchestrationGetTurnDiffResultType, CheckpointServiceError>;

    /**
     * Read the full patch diff across a thread range of checkpoints.
     *
     * Uses turn-diff semantics with `fromTurnCount = 0`.
     */
    readonly getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Effect.Effect<OrchestrationGetFullThreadDiffResult, CheckpointServiceError>;
  }
>()("t3/checkpointing/CheckpointDiffQuery") {}

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

function buildTurnDiffResult(
  input: {
    readonly threadId: ThreadId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  },
  output: {
    readonly diff: string;
    readonly availability: OrchestrationGetTurnDiffResultType["availability"];
    readonly lineage: CheckpointLineage | null;
  },
): OrchestrationGetTurnDiffResultType {
  return {
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
    ...output,
  };
}

export const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;

  const unavailable = (
    input: {
      readonly threadId: ThreadId;
      readonly fromTurnCount: number;
      readonly toTurnCount: number;
    },
    reason: Extract<
      OrchestrationGetTurnDiffResultType["availability"],
      { status: "unavailable" }
    >["reason"],
    lineage: CheckpointLineage | null = null,
  ) =>
    buildTurnDiffResult(input, {
      diff: "",
      availability: { status: "unavailable", reason },
      lineage,
    });

  const resolveRepositoryCwd = Effect.fn("CheckpointDiffQuery.resolveRepositoryCwd")(function* (
    worktreePath: string | null,
    workspaceRoot: string,
  ) {
    const candidates = [
      ...new Set([worktreePath, workspaceRoot].filter((value) => value !== null)),
    ];
    for (const candidate of candidates) {
      if (yield* checkpointStore.isGitRepository(candidate)) {
        return candidate;
      }
    }
    return null;
  });

  const lineagesAreCompatible = Effect.fn("CheckpointDiffQuery.lineagesAreCompatible")(function* (
    cwd: string,
    from: CheckpointLineage,
    to: CheckpointLineage,
  ) {
    if (
      from.repositoryRoot !== to.repositoryRoot ||
      from.worktreePath !== to.worktreePath ||
      from.branch !== to.branch
    ) {
      return false;
    }
    if (from.headCommit === null || to.headCommit === null) {
      return from.headCommit === to.headCommit;
    }
    if (from.headCommit === to.headCommit) {
      return true;
    }
    return yield* checkpointStore.isAncestor({
      cwd,
      ancestorCommit: from.headCommit,
      descendantCommit: to.headCommit,
    });
  });

  const diffCompatibleCheckpoints = Effect.fn("CheckpointDiffQuery.diffCompatibleCheckpoints")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly fromTurnCount: number;
      readonly toTurnCount: number;
      readonly cwd: string;
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly ignoreWhitespace: boolean;
    }) {
      const [fromLineage, toLineage] = yield* Effect.all([
        checkpointStore.inspectCheckpoint({
          cwd: input.cwd,
          checkpointRef: input.fromCheckpointRef,
        }),
        checkpointStore.inspectCheckpoint({ cwd: input.cwd, checkpointRef: input.toCheckpointRef }),
      ]);
      if (!toLineage) {
        return unavailable(input, "checkpoint-unavailable");
      }
      if (!fromLineage) {
        return unavailable(input, "lineage-unavailable", toLineage);
      }
      if (!(yield* lineagesAreCompatible(input.cwd, fromLineage, toLineage))) {
        return unavailable(input, "lineage-changed", toLineage);
      }
      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: input.cwd,
        fromCheckpointRef: input.fromCheckpointRef,
        toCheckpointRef: input.toCheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace: input.ignoreWhitespace,
      });
      return buildTurnDiffResult(input, {
        diff,
        availability: { status: "available" },
        lineage: toLineage,
      });
    },
  );

  const getTurnDiff: CheckpointDiffQuery["Service"]["getTurnDiff"] = Effect.fn("getTurnDiff")(
    function* (input) {
      const operation = "CheckpointDiffQuery.getTurnDiff";
      const ignoreWhitespace = input.ignoreWhitespace ?? true;
      yield* Effect.annotateCurrentSpan({
        "checkpoint.thread_id": input.threadId,
        "checkpoint.from_turn_count": input.fromTurnCount,
        "checkpoint.to_turn_count": input.toTurnCount,
        "checkpoint.ignore_whitespace": ignoreWhitespace,
      });

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
          availability: { status: "available" },
          lineage: null,
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointDiffResultInvalidError({
            operation,
            threadId: input.threadId,
          });
        }
        return emptyDiff;
      }

      const threadContext = yield* projectionSnapshotQuery
        .getThreadCheckpointContext(input.threadId)
        .pipe(Effect.withSpan("checkpoint.turnDiff.lookupContext"));
      if (Option.isNone(threadContext)) {
        return yield* new CheckpointThreadNotFoundError({
          operation,
          threadId: input.threadId,
        });
      }

      const maxTurnCount = threadContext.value.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointTurnRangeUnavailableError({
          operation,
          threadId: input.threadId,
          requestedTurnCount: input.toTurnCount,
          availableTurnCount: maxTurnCount,
        });
      }

      const workspaceCwd = yield* resolveRepositoryCwd(
        threadContext.value.worktreePath,
        threadContext.value.workspaceRoot,
      );
      if (!workspaceCwd) {
        return unavailable(input, "workspace-unavailable");
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForThreadTurn(input.threadId, 0)
          : threadContext.value.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            )?.checkpointRef;
      if (!fromCheckpointRef) {
        return unavailable(input, "checkpoint-unavailable");
      }

      const toCheckpointRef = threadContext.value.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      )?.checkpointRef;
      if (!toCheckpointRef) {
        return unavailable(input, "checkpoint-unavailable");
      }

      const lineageBaselineRef = checkpointLineageBaselineRefForThreadTurn(
        input.threadId,
        input.toTurnCount,
      );
      const adjacentBaselineRef = checkpointBaselineRefForThreadTurn(
        input.threadId,
        input.toTurnCount,
      );
      const useLineageBaseline =
        input.toTurnCount === input.fromTurnCount + 1 &&
        (yield* checkpointStore.hasCheckpointRef({
          cwd: workspaceCwd,
          checkpointRef: lineageBaselineRef,
        }));
      const useAdjacentBaseline =
        !useLineageBaseline &&
        input.toTurnCount === input.fromTurnCount + 1 &&
        (yield* checkpointStore.hasCheckpointRef({
          cwd: workspaceCwd,
          checkpointRef: adjacentBaselineRef,
        }));
      const turnDiff = yield* diffCompatibleCheckpoints({
        ...input,
        cwd: workspaceCwd,
        fromCheckpointRef: useLineageBaseline
          ? lineageBaselineRef
          : useAdjacentBaseline
            ? adjacentBaselineRef
            : fromCheckpointRef,
        toCheckpointRef,
        ignoreWhitespace,
      }).pipe(Effect.withSpan("checkpoint.turnDiff.diffCheckpoints"));
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointDiffResultInvalidError({
          operation,
          threadId: input.threadId,
        });
      }

      return turnDiff;
    },
  );

  const getFullThreadDiff: CheckpointDiffQuery["Service"]["getFullThreadDiff"] = Effect.fn(
    "CheckpointDiffQuery.getFullThreadDiff",
  )(function* (input) {
    const operation = "CheckpointDiffQuery.getFullThreadDiff";
    const ignoreWhitespace = input.ignoreWhitespace ?? true;
    yield* Effect.annotateCurrentSpan({
      "checkpoint.thread_id": input.threadId,
      "checkpoint.from_turn_count": 0,
      "checkpoint.to_turn_count": input.toTurnCount,
      "checkpoint.ignore_whitespace": ignoreWhitespace,
      "checkpoint.diff_kind": "full-thread",
    });

    if (input.toTurnCount === 0) {
      const emptyDiff = buildTurnDiffResult(
        {
          threadId: input.threadId,
          fromTurnCount: 0,
          toTurnCount: 0,
        },
        { diff: "", availability: { status: "available" }, lineage: null },
      );
      if (!isTurnDiffResult(emptyDiff)) {
        return yield* new CheckpointDiffResultInvalidError({
          operation,
          threadId: input.threadId,
        });
      }
      return emptyDiff satisfies OrchestrationGetFullThreadDiffResult;
    }

    const threadContext = yield* projectionSnapshotQuery
      .getFullThreadDiffContext(input.threadId, input.toTurnCount)
      .pipe(Effect.withSpan("checkpoint.fullThread.lookupContext"));

    if (Option.isNone(threadContext)) {
      return yield* new CheckpointThreadNotFoundError({
        operation,
        threadId: input.threadId,
      });
    }

    if (input.toTurnCount > threadContext.value.latestCheckpointTurnCount) {
      return yield* new CheckpointTurnRangeUnavailableError({
        operation,
        threadId: input.threadId,
        requestedTurnCount: input.toTurnCount,
        availableTurnCount: threadContext.value.latestCheckpointTurnCount,
      });
    }

    const workspaceCwd = yield* resolveRepositoryCwd(
      threadContext.value.worktreePath,
      threadContext.value.workspaceRoot,
    );
    if (!workspaceCwd) {
      return unavailable({ ...input, fromTurnCount: 0 }, "workspace-unavailable");
    }

    if (!threadContext.value.toCheckpointRef) {
      return unavailable({ ...input, fromTurnCount: 0 }, "checkpoint-unavailable");
    }

    const turnDiff = yield* diffCompatibleCheckpoints({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
      cwd: workspaceCwd,
      fromCheckpointRef: checkpointRefForThreadTurn(input.threadId, 0),
      toCheckpointRef: threadContext.value.toCheckpointRef as CheckpointRef,
      ignoreWhitespace,
    }).pipe(Effect.withSpan("checkpoint.fullThread.diffCheckpoints"));
    if (!isTurnDiffResult(turnDiff)) {
      return yield* new CheckpointDiffResultInvalidError({
        operation,
        threadId: input.threadId,
      });
    }

    return turnDiff satisfies OrchestrationGetFullThreadDiffResult;
  });

  return CheckpointDiffQuery.of({
    getTurnDiff,
    getFullThreadDiff,
  });
});

export const layer = Layer.effect(CheckpointDiffQuery, make);
