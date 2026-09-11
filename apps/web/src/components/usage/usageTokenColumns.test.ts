import { describe, expect, it } from "vite-plus/test";
import type { UsageTimelineCell } from "@t3tools/shared/usageMerge";
import { usageTokenColumns } from "./usageTokenColumns";

const cell: UsageTimelineCell = {
  periodStart: "2026-09-10T00:00:00Z",
  projectKey: "one",
  project: "One",
  provider: "codex",
  model: "model",
  costUsd: 1,
  totalTokens: 100,
  totals: {
    uncachedInputTokens: 20,
    outputTokens: 30,
    cachedInputTokens: 40,
    cacheCreationTokens: 10,
    reasoningTokens: 15,
  },
};
describe("usageTokenColumns", () => {
  it("keeps fresh input, cached reads, writes, and reasoning disjoint", () => {
    expect(usageTokenColumns([cell, cell], (entry) => entry.provider).get("codex")).toEqual({
      inputTokens: 40,
      outputTokens: 60,
      cacheReadTokens: 80,
    });
  });
  it("does not show zero when a source lacks component counts", () => {
    const { totals: _totals, ...missing } = cell;
    expect(usageTokenColumns([cell, missing], (entry) => entry.provider).get("codex")).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
    });
  });
});
