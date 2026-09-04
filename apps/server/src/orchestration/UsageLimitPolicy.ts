/**
 * Deterministic limits applied before T3 starts provider work.
 *
 * Provider CLIs own any subagents they create, so this policy deliberately
 * governs the resources T3 can stop before launch: oversized conversations
 * and concurrent top-level provider turns.
 *
 * @module UsageLimitPolicy
 */
import {
  DEFAULT_THREAD_CONTEXT_TOKEN_LIMIT,
  type OrchestrationThreadActivity,
  type ProviderInstanceId,
  type ProviderSession,
  type ThreadId,
} from "@t3tools/contracts";

export { DEFAULT_THREAD_CONTEXT_TOKEN_LIMIT };
export const MAX_CONCURRENT_PROVIDER_TURNS = 8;

export type UsageLimitViolation = {
  readonly code: "context-limit" | "concurrent-turn-limit" | "handover-in-progress";
  readonly detail: string;
};

function contextLimitViolation(input: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly contextTokenLimit?: number;
}): UsageLimitViolation | undefined {
  const usedTokens = latestContextTokens(input.activities);
  const contextTokenLimit = input.contextTokenLimit ?? DEFAULT_THREAD_CONTEXT_TOKEN_LIMIT;
  if (usedTokens !== undefined && usedTokens >= contextTokenLimit) {
    return {
      code: "context-limit",
      detail: `T3 usage limit: this thread has used ${usedTokens.toLocaleString("en-US")} context tokens. The hard limit is ${contextTokenLimit.toLocaleString("en-US")}. Start a new thread so the old conversation is not sent to the provider again.`,
    };
  }
  return undefined;
}

function concurrentTurnLimitViolation(runningTurnCount: number): UsageLimitViolation | undefined {
  if (runningTurnCount < MAX_CONCURRENT_PROVIDER_TURNS) {
    return undefined;
  }
  return {
    code: "concurrent-turn-limit",
    detail: `T3 usage limit: ${runningTurnCount} provider turns are already running. The hard limit is ${MAX_CONCURRENT_PROVIDER_TURNS}. Wait for one to finish or interrupt it before starting more work.`,
  };
}

function latestContextTokens(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): number | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "context-window.updated") continue;
    const payload = activity.payload as Record<string, unknown> | undefined;
    const usedTokens = payload?.["usedTokens"];
    if (typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0) {
      return usedTokens;
    }
  }
  return undefined;
}

function isRunningSession(session: ProviderSession): boolean {
  return session.status === "connecting" || session.status === "running";
}

function runningTurnThreadIds(
  sessions: ReadonlyArray<ProviderSession>,
  reservedTurnThreadIds: ReadonlyArray<ThreadId>,
  excludedProviderInstanceIds: ReadonlySet<ProviderInstanceId>,
): ReadonlySet<ThreadId> {
  return new Set([
    ...sessions
      .filter(
        (session) =>
          isRunningSession(session) &&
          (session.providerInstanceId === undefined ||
            !excludedProviderInstanceIds.has(session.providerInstanceId)),
      )
      .map((session) => session.threadId),
    ...reservedTurnThreadIds,
  ]);
}

export function evaluateTurnStartLimits(input: {
  readonly threadId: ThreadId;
  readonly contextTokenLimit?: number;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly sessions: ReadonlyArray<ProviderSession>;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly excludedProviderInstanceIds?: ReadonlySet<ProviderInstanceId>;
  readonly reservedTurnThreadIds?: ReadonlyArray<ThreadId>;
  readonly reservedHandoverCount?: number;
}): UsageLimitViolation | undefined {
  const contextViolation = contextLimitViolation(input);
  if (contextViolation) return contextViolation;

  const currentThreadIsRunning =
    input.sessions.some(
      (session) => session.threadId === input.threadId && isRunningSession(session),
    ) || input.reservedTurnThreadIds?.includes(input.threadId) === true;
  const excludedProviderInstanceIds = input.excludedProviderInstanceIds ?? new Set();
  if (
    input.providerInstanceId !== undefined &&
    excludedProviderInstanceIds.has(input.providerInstanceId)
  ) {
    return undefined;
  }
  const runningTurnCount =
    runningTurnThreadIds(
      input.sessions,
      input.reservedTurnThreadIds ?? [],
      excludedProviderInstanceIds,
    ).size + (input.reservedHandoverCount ?? 0);
  return currentThreadIsRunning ? undefined : concurrentTurnLimitViolation(runningTurnCount);
}

export function evaluateHandoverStartLimits(input: {
  readonly sessions: ReadonlyArray<ProviderSession>;
  readonly excludedProviderInstanceIds?: ReadonlySet<ProviderInstanceId>;
  readonly reservedTurnThreadIds?: ReadonlyArray<ThreadId>;
  readonly reservedHandoverCount?: number;
}): UsageLimitViolation | undefined {
  return concurrentTurnLimitViolation(
    runningTurnThreadIds(
      input.sessions,
      input.reservedTurnThreadIds ?? [],
      input.excludedProviderInstanceIds ?? new Set(),
    ).size + (input.reservedHandoverCount ?? 0),
  );
}
