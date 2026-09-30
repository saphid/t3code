import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  MessageId,
  type OrchestrationV2Run,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { ProjectionRuntimeRecoveryState } from "./ProjectionStore.ts";

import { ServerSettingsService } from "../serverSettings.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

export function restartContinuationRun(
  projection: Pick<
    ProjectionRuntimeRecoveryState,
    "thread" | "runs" | "providerThreads" | "providerSessions" | "providerTurns"
  >,
): OrchestrationV2Run | undefined {
  if (projection.thread.archivedAt !== null || projection.thread.deletedAt !== null) return;
  const run = projection.runs.reduce<OrchestrationV2Run | undefined>(
    (latest, candidate) => (!latest || candidate.ordinal > latest.ordinal ? candidate : latest),
    undefined,
  );
  if (!run) return;
  const preparedContinuation =
    run.status === "starting" && run.restartContinuationOfRunId !== undefined;
  if (run.status !== "running" && !preparedContinuation) return;
  if (projection.thread.providerInstanceId !== run.providerInstanceId) return;
  const providerThread = projection.providerThreads.find(
    (thread) => thread.id === run.providerThreadId,
  );
  if (
    !providerThread ||
    providerThread.appThreadId !== projection.thread.id ||
    providerThread.ownerNodeId !== null ||
    providerThread.providerInstanceId !== run.providerInstanceId ||
    providerThread.nativeThreadRef?.nativeId == null ||
    providerThread.nativeThreadRef.strength !== "strong" ||
    providerThread.nativeThreadRef.driver !== providerThread.driver ||
    (!preparedContinuation && providerThread.status !== "active") ||
    providerThread.status === "closed" ||
    providerThread.status === "archived"
  )
    return;
  const session = projection.providerSessions.find(
    (candidate) => candidate.id === providerThread.providerSessionId,
  );
  if (
    !session ||
    session.providerInstanceId !== run.providerInstanceId ||
    session.driver !== providerThread.driver ||
    (!preparedContinuation && session.status !== "running")
  )
    return;
  if (
    !preparedContinuation &&
    !projection.providerTurns.some(
      (turn) =>
        turn.providerThreadId === providerThread.id &&
        turn.runAttemptId === run.activeAttemptId &&
        turn.status === "running",
    )
  )
    return;
  return run;
}

/**
 * The run a startup reconcile interrupted, for threads whose saved provider
 * state does not satisfy `restartContinuationRun`. A manual "continue" on such
 * a thread starts normally, so the opt-in covers it too. Runs that were
 * waiting on the user, in either sense (status `waiting`, or `running` with an
 * unanswered runtime request such as a question), are left alone: recovery
 * expires the request, and answering it is the user's move.
 * Queued runs after the interrupted one do not disqualify it; delivery
 * releases them instead of adding a prompt.
 */
export function interruptedRunToContinue(
  projection: Pick<ProjectionRuntimeRecoveryState, "thread" | "runs" | "nodes" | "runtimeRequests">,
  interruptedRuns: ReadonlyArray<OrchestrationV2Run>,
): OrchestrationV2Run | undefined {
  if (projection.thread.archivedAt !== null || projection.thread.deletedAt !== null) return;
  const latest = projection.runs
    .filter((run) => run.status !== "queued")
    .reduce<OrchestrationV2Run | undefined>(
      (current, candidate) =>
        !current || candidate.ordinal > current.ordinal ? candidate : current,
      undefined,
    );
  if (!latest || projection.thread.providerInstanceId !== latest.providerInstanceId) return;
  if (latest.status !== "preparing" && latest.status !== "starting" && latest.status !== "running")
    return;
  if (!interruptedRuns.some((run) => run.id === latest.id)) return;
  const nodeIds = new Set(
    projection.nodes.filter((node) => node.runId === latest.id).map((node) => node.id),
  );
  const awaitingUser = projection.runtimeRequests.some(
    (request) => request.status === "pending" && nodeIds.has(request.nodeId),
  );
  return awaitingUser ? undefined : latest;
}

export const continueRestartedRun = Effect.fn("RestartContinuation.continueRestartedRun")(
  function* (input: { readonly threadId: ThreadId; readonly sourceRunId: RunId }) {
    const settings = yield* ServerSettingsService;
    const enabled = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
    if (!enabled) return;
    const threads = yield* ThreadManagementService;
    const messageId = MessageId.make(`message:restart-continuation:${input.sourceRunId}`);
    const projection = yield* threads.getThreadRecords(input.threadId, ["messages", "runs"], {
      messageIds: [messageId],
    });
    if (
      !resolveProjectSettings(enabled, projection.thread.projectId).settings
        .continueThreadsAfterServerUpdate
    )
      return;
    if (projection.thread.archivedAt !== null || projection.thread.deletedAt !== null) return;

    if (projection.messages.some((message) => message.id === messageId)) return;
    const source = projection.runs.find((run) => run.id === input.sourceRunId);
    if (!source || source.status !== "cancelled") return;
    // A user submission after reconciliation takes precedence over an automatic
    // prompt. Queued work the restart held is that submission: release it so
    // it drains now instead of waiting for someone to notice the held queue.
    const later = projection.runs.filter((run) => run.ordinal > source.ordinal);
    if (later.length > 0) {
      if (later.some((run) => run.status === "queued" && run.queueHeld === true)) {
        yield* threads.dispatch({
          type: "queue.resume",
          // Unique per delivery: a replayed effect after another restart must
          // release the queue that restart held again, not hit the old receipt.
          commandId: CommandId.make(
            `command:restart-queue-resume:${input.sourceRunId}:${yield* Clock.currentTimeMillis}`,
          ),
          threadId: input.threadId,
        });
      }
      return;
    }
    if (projection.thread.providerInstanceId !== source.providerInstanceId) return;
    yield* threads.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`command:restart-continuation:${input.sourceRunId}`),
      threadId: input.threadId,
      messageId,
      text: "Continue where you left off.",
      attachments: [],
      modelSelection: source.modelSelection,
      dispatchMode: { type: "start_immediately" },
      createdBy: "agent",
      creationSource: "server",
      restartContinuationOfRunId: input.sourceRunId,
    });
  },
);
