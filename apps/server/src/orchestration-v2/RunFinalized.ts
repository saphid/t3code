import {
  EventId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2RunFinalizedOutcome,
  type RunId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

/**
 * Each run has one `run.finalized` id. The event log's unique event id keeps
 * the milestone once per run, and consumers can deduplicate deliveries by it.
 */
export const runFinalizedEventId = (runId: RunId) => EventId.make(`event:run-finalized:${runId}`);

/**
 * The checkpoint capture a terminal run enqueues. While it is unsettled, the
 * run finalizes when RunFinalizationService finishes it, not at the terminal
 * write.
 */
export const checkpointCaptureEffectId = (runId: RunId) => `effect:checkpoint.capture:${runId}`;

const SETTLED_RUN_STATUSES: ReadonlySet<string> = new Set<OrchestrationV2Run["status"]>([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "rolled_back",
]);

/** Whether a persisted run status is final, including a discarded (rolled-back) run. */
export const isSettledRunStatus = (status: string) => SETTLED_RUN_STATUSES.has(status);

/** The finalized outcome for a run status, or null when the run is not finished or was discarded. */
export const runFinalizedOutcome = (
  status: OrchestrationV2Run["status"],
): OrchestrationV2RunFinalizedOutcome | null =>
  status === "completed" ||
  status === "failed" ||
  status === "interrupted" ||
  status === "cancelled"
    ? status
    : null;

export const makeRunFinalizedEvent = (input: {
  readonly run: OrchestrationV2Run;
  readonly outcome: OrchestrationV2RunFinalizedOutcome;
  readonly occurredAt: DateTime.Utc;
}): Extract<OrchestrationV2DomainEvent, { readonly type: "run.finalized" }> => ({
  id: runFinalizedEventId(input.run.id),
  type: "run.finalized",
  threadId: input.run.threadId,
  runId: input.run.id,
  ...(input.run.rootNodeId === null ? {} : { nodeId: input.run.rootNodeId }),
  providerInstanceId: input.run.providerInstanceId,
  occurredAt: input.occurredAt,
  payload: {
    runId: input.run.id,
    outcome: input.outcome,
    checkpointId: input.run.checkpointId,
  },
});
