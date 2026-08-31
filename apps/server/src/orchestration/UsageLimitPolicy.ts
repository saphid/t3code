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
  MAX_CONTEXT_TOKENS_PER_THREAD,
  type OrchestrationThreadActivity,
  type ProviderSession,
  type ThreadId,
} from "@t3tools/contracts";

export { MAX_CONTEXT_TOKENS_PER_THREAD };
export const MAX_CONCURRENT_PROVIDER_TURNS = 8;

export type UsageLimitViolation = {
  readonly code: "context-limit" | "concurrent-turn-limit";
  readonly detail: string;
};

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

export function evaluateTurnStartLimits(input: {
  readonly threadId: ThreadId;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly sessions: ReadonlyArray<ProviderSession>;
}): UsageLimitViolation | undefined {
  const usedTokens = latestContextTokens(input.activities);
  if (usedTokens !== undefined && usedTokens >= MAX_CONTEXT_TOKENS_PER_THREAD) {
    return {
      code: "context-limit",
      detail: `T3 usage limit: this thread has used ${usedTokens.toLocaleString("en-US")} context tokens. The hard limit is ${MAX_CONTEXT_TOKENS_PER_THREAD.toLocaleString("en-US")}. Start a new thread so the old conversation is not sent to the provider again.`,
    };
  }

  const currentThreadIsRunning = input.sessions.some(
    (session) => session.threadId === input.threadId && isRunningSession(session),
  );
  const runningTurnCount = input.sessions.filter(isRunningSession).length;
  if (!currentThreadIsRunning && runningTurnCount >= MAX_CONCURRENT_PROVIDER_TURNS) {
    return {
      code: "concurrent-turn-limit",
      detail: `T3 usage limit: ${runningTurnCount} provider turns are already running. The hard limit is ${MAX_CONCURRENT_PROVIDER_TURNS}. Wait for one to finish or interrupt it before starting more work.`,
    };
  }

  return undefined;
}
