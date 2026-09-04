import type {
  OrchestrationThreadActivity,
  ProviderInstanceId,
  ProviderSession,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  evaluateTurnStartLimits,
  evaluateHandoverStartLimits,
  MAX_CONCURRENT_PROVIDER_TURNS,
  DEFAULT_THREAD_CONTEXT_TOKEN_LIMIT,
} from "./UsageLimitPolicy.ts";

const threadId = "thread-limited" as ThreadId;

function contextActivity(usedTokens: number): OrchestrationThreadActivity {
  return {
    id: `usage-${usedTokens}`,
    createdAt: "2026-08-31T00:00:00.000Z",
    tone: "info",
    kind: "context-window.updated",
    summary: "Context window updated",
    payload: { usedTokens, maxTokens: 400_000 },
    turnId: null,
  } as OrchestrationThreadActivity;
}

function session(index: number, status: ProviderSession["status"] = "running"): ProviderSession {
  return {
    threadId: `thread-${index}` as ThreadId,
    status,
  } as ProviderSession;
}

const aiEnablers = "ai-enablers" as ProviderInstanceId;

describe("evaluateTurnStartLimits", () => {
  it("blocks a thread at the context ceiling", () => {
    const violation = evaluateTurnStartLimits({
      threadId,
      activities: [contextActivity(DEFAULT_THREAD_CONTEXT_TOKEN_LIMIT)],
      sessions: [],
    });

    expect(violation?.code).toBe("context-limit");
  });

  it("allows handover generation at the context ceiling", () => {
    expect(evaluateHandoverStartLimits({ sessions: [] })).toBeUndefined();
  });

  it("counts each active thread once across sessions and reservations", () => {
    const violation = evaluateTurnStartLimits({
      threadId: "new-thread" as ThreadId,
      activities: [],
      sessions: [session(1), session(1), session(2)],
      reservedTurnThreadIds: ["thread-1" as ThreadId, "thread-3" as ThreadId],
    });

    expect(violation).toBeUndefined();
  });

  it("uses the latest context snapshot", () => {
    const violation = evaluateTurnStartLimits({
      threadId,
      activities: [contextActivity(DEFAULT_THREAD_CONTEXT_TOKEN_LIMIT), contextActivity(20_000)],
      sessions: [],
    });

    expect(violation).toBeUndefined();
  });

  it("uses the configured context ceiling", () => {
    const violation = evaluateTurnStartLimits({
      threadId,
      contextTokenLimit: 100_000,
      activities: [contextActivity(100_000)],
      sessions: [],
    });

    expect(violation?.code).toBe("context-limit");
    expect(violation?.detail).toContain("100,000");
  });

  it("blocks a new turn when the global concurrency ceiling is full", () => {
    const violation = evaluateTurnStartLimits({
      threadId,
      activities: [],
      sessions: Array.from({ length: MAX_CONCURRENT_PROVIDER_TURNS }, (_, index) => session(index)),
    });

    expect(violation?.code).toBe("concurrent-turn-limit");
  });

  it("does not count running AI Enablers threads toward the concurrency ceiling", () => {
    const sessions = [
      ...Array.from({ length: MAX_CONCURRENT_PROVIDER_TURNS - 1 }, (_, index) => session(index)),
      { ...session(99), providerInstanceId: aiEnablers },
    ];

    expect(
      evaluateTurnStartLimits({
        threadId,
        activities: [],
        sessions,
        excludedProviderInstanceIds: new Set([aiEnablers]),
      }),
    ).toBeUndefined();
  });

  it("allows AI Enablers turns when the concurrency ceiling is full", () => {
    const sessions = Array.from({ length: MAX_CONCURRENT_PROVIDER_TURNS }, (_, index) =>
      session(index),
    );

    expect(
      evaluateTurnStartLimits({
        threadId,
        providerInstanceId: aiEnablers,
        activities: [],
        sessions,
        excludedProviderInstanceIds: new Set([aiEnablers]),
      }),
    ).toBeUndefined();
  });

  it("counts a turn reservation before the provider reports it as running", () => {
    const violation = evaluateTurnStartLimits({
      threadId,
      activities: [],
      sessions: Array.from({ length: MAX_CONCURRENT_PROVIDER_TURNS - 1 }, (_, index) =>
        session(index),
      ),
      reservedTurnThreadIds: ["reserved-thread" as ThreadId],
    });

    expect(violation?.code).toBe("concurrent-turn-limit");
  });

  it("counts handover reservations against the shared provider-work ceiling", () => {
    const violation = evaluateTurnStartLimits({
      threadId,
      activities: [],
      sessions: Array.from({ length: MAX_CONCURRENT_PROVIDER_TURNS - 1 }, (_, index) =>
        session(index),
      ),
      reservedHandoverCount: 1,
    });

    expect(violation?.code).toBe("concurrent-turn-limit");
  });

  it("does not count ready sessions and permits an already-running thread", () => {
    const sessions = [
      ...Array.from({ length: MAX_CONCURRENT_PROVIDER_TURNS }, (_, index) => session(index)),
      { ...session(99), threadId, status: "running" as const },
      session(100, "ready"),
    ];

    expect(evaluateTurnStartLimits({ threadId, activities: [], sessions })).toBeUndefined();
  });
});
