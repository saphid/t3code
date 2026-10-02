import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

type LimitRecoveryCandidate = ProjectionStore.ProjectionLimitRecoveryCandidate;

/** The reset time of a thread whose latest run stopped on a usage limit it can recover from. */
function blockingResetMs(thread: LimitRecoveryCandidate): number | null {
  if (
    thread.status !== "failed" ||
    thread.lastErrorClass !== "usage_limit" ||
    !thread.latestRunId ||
    !thread.usageLimitResetAt ||
    thread.archivedAt !== null ||
    thread.settledOverride === "settled" ||
    thread.pendingRuntimeRequest !== null
  )
    return null;
  const resetMs = Date.parse(thread.usageLimitResetAt);
  // An already-expired window reported with a fresh failure cannot start a retry loop.
  if (!Number.isFinite(resetMs) || resetMs <= stoppedAtMs(thread)) return null;
  return resetMs;
}

const stoppedAtMs = (thread: LimitRecoveryCandidate) =>
  DateTime.toEpochMillis(thread.latestRunCompletedAt ?? thread.updatedAt);

const matchingRecovery = (thread: LimitRecoveryCandidate) =>
  thread.limitRecovery?.runId === thread.latestRunId &&
  thread.limitRecovery.resetAt === thread.usageLimitResetAt
    ? thread.limitRecovery
    : null;

/** The persisted run and reset form the identity of one recovery opportunity. */
export function limitRecoveryCommand(
  thread: LimitRecoveryCandidate,
  autoResume: boolean,
  nowMs: number,
  snooze = false,
): OrchestrationV2Command | null {
  const resetMs = blockingResetMs(thread);
  if (resetMs === null || !thread.latestRunId || !thread.usageLimitResetAt) return null;
  const identity = `${thread.id}:${thread.latestRunId}:${resetMs}`;
  const recovery = matchingRecovery(thread);
  if (recovery === null) {
    if (!autoResume && (!snooze || resetMs <= nowMs)) return null;
    return {
      type: "thread.metadata.update",
      commandId: CommandId.make(`limit-arm:${identity}`),
      threadId: thread.id,
      limitRecovery: {
        runId: thread.latestRunId,
        resetAt: thread.usageLimitResetAt,
        autoResume,
        snooze: snooze && resetMs > nowMs,
      },
    };
  }
  if (
    !recovery.autoResume ||
    Date.parse(recovery.clearedAt ?? recovery.resetAt) > nowMs ||
    (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
  )
    return null;
  const deliveryIdentity = `${identity}:${recovery.requestId ?? "legacy"}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(`limit-resume:${deliveryIdentity}`),
    messageId: MessageId.make(`limit-resume:${deliveryIdentity}`),
    threadId: thread.id,
    usageLimitContinuationOfRunId: thread.latestRunId,
    ...(recovery.requestId === undefined
      ? {}
      : { usageLimitRecoveryRequestId: recovery.requestId }),
    text: "Continue where you left off.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "server",
  };
}

/**
 * Records that a reset credit redeemed at `clearedAtMs` lifted a limit before
 * its reported reset. Only a limit that stopped the run before the redeem is
 * cleared by it. Recovery choices are left to the thread, so a choice made
 * while this command is in flight is never overwritten.
 */
export function limitClearedCommand(
  thread: LimitRecoveryCandidate,
  clearedAtMs: number,
): OrchestrationV2Command | null {
  const resetMs = blockingResetMs(thread);
  if (
    resetMs === null ||
    !thread.latestRunId ||
    !thread.usageLimitResetAt ||
    resetMs <= clearedAtMs ||
    stoppedAtMs(thread) >= clearedAtMs
  )
    return null;
  if (matchingRecovery(thread)?.clearedAt !== undefined) return null;
  return {
    type: "thread.metadata.update",
    commandId: CommandId.make(`limit-clear:${thread.id}:${thread.latestRunId}:${resetMs}`),
    threadId: thread.id,
    limitRecovery: {
      runId: thread.latestRunId,
      resetAt: thread.usageLimitResetAt,
      clearedAt: DateTime.formatIso(DateTime.makeUnsafe(clearedAtMs)),
    },
  };
}

/** Applies provider limit changes to threads waiting on usage-limit recovery. */
export class UsageLimitRecovery extends Context.Service<
  UsageLimitRecovery,
  {
    /** A reset credit redeemed on this instance at `redeemedAt` lifted its limits. */
    readonly limitCleared: (
      instanceId: ProviderInstanceId,
      redeemedAt: DateTime.Utc,
    ) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/UsageLimitRecoveryWorker/UsageLimitRecovery") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const dispatch = (thread: LimitRecoveryCandidate, command: OrchestrationV2Command) =>
    threads.dispatch(command).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("orchestration-v2.limit-recovery.dispatch-failed", {
          threadId: thread.id,
          cause,
        }),
      ),
    );
  const sweep = Effect.fn("UsageLimitRecoveryWorker.sweep")(function* () {
    const preferences = yield* settings.getSettings;
    const now = yield* DateTime.now;
    const candidates = yield* projections.getLimitRecoveryCandidates({
      now,
      autoResume: preferences.autoResumeLimitedThreads,
      snooze: preferences.snoozeLimitedThreads,
    });
    const nowMs = DateTime.toEpochMillis(now);
    for (const thread of candidates) {
      const command = limitRecoveryCommand(
        thread,
        preferences.autoResumeLimitedThreads,
        nowMs,
        preferences.snoozeLimitedThreads,
      );
      if (command === null) continue;
      yield* dispatch(thread, command);
    }
  });
  const limitCleared = Effect.fn("UsageLimitRecovery.limitCleared")(
    function* (instanceId: ProviderInstanceId, redeemedAt: DateTime.Utc) {
      const candidates = yield* projections.getLimitRecoveryCandidates({
        now: yield* DateTime.now,
        autoResume: false,
        snooze: false,
        limitedOn: instanceId,
      });
      for (const thread of candidates) {
        const command = limitClearedCommand(thread, DateTime.toEpochMillis(redeemedAt));
        if (command !== null) yield* dispatch(thread, command);
      }
    },
    (effect, instanceId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.limit-recovery.clear-failed", { instanceId, cause }),
        ),
      ),
  );
  // The shared scheduler derives due work from persisted failures and recovery
  // choices, so restarts need no timer restoration or connected client.
  const scheduler = yield* Scheduler.Scheduler;
  yield* scheduler.register("usage-limit-recovery", sweep());
  return UsageLimitRecovery.of({ limitCleared });
});

export const workerLive = Layer.effect(UsageLimitRecovery, make);
