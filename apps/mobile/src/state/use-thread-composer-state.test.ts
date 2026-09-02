import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { threadContextReachedLimit } from "./contextLimit.ts";

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

describe("threadContextReachedLimit", () => {
  it("does not apply a limit before server configuration loads", () => {
    expect(threadContextReachedLimit([contextActivity(300_000)], undefined)).toBe(false);
  });

  it("uses the configured limit", () => {
    expect(threadContextReachedLimit([contextActivity(100_000)], 100_000)).toBe(true);
    expect(threadContextReachedLimit([contextActivity(99_999)], 100_000)).toBe(false);
  });
});
