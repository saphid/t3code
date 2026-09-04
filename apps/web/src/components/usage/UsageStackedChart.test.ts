import { describe, expect, it } from "vite-plus/test";

import { groupTimeline, projectSeriesKey } from "./UsageStackedChart";

const cells = [
  {
    periodStart: "2026-09-01T00:00:00.000Z",
    projectKey: "env:id:one",
    project: "One",
    provider: "codex" as const,
    model: "gpt-5.6-sol",
    costUsd: 2,
    totalTokens: 200,
  },
  {
    periodStart: "2026-09-01T00:30:00.000Z",
    projectKey: "env:id:one",
    project: "One",
    provider: "claude" as const,
    model: "claude-fable-5",
    costUsd: 3,
    totalTokens: 300,
  },
] as const;

describe("groupTimeline", () => {
  it("retains half-hour cells while grouping them into a selected visual interval", () => {
    const models = new Set(["codex\u0000gpt-5.6-sol", "claude\u0000claude-fable-5"]);
    const halfHours = groupTimeline(
      cells,
      "projects",
      "cost",
      "30m",
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T01:00:00.000Z",
      models,
    );
    const hours = groupTimeline(
      cells,
      "projects",
      "cost",
      "1h",
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T01:00:00.000Z",
      models,
    );

    expect(halfHours).toHaveLength(2);
    expect(halfHours.map((point) => point.values.get("project:env:id:one"))).toEqual([2, 3]);
    expect(hours[0]?.values.get("project:env:id:one")).toBe(5);
  });

  it("filters individual models without dropping the provider dimension", () => {
    const result = groupTimeline(
      cells,
      "providers",
      "tokens",
      "1h",
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T01:00:00.000Z",
      new Set(["codex\u0000gpt-5.6-sol"]),
    );
    expect(result[0]?.values.get("codex")).toBe(200);
    expect(result[0]?.values.has("claude")).toBe(false);
  });
});

describe("projectSeriesKey", () => {
  it("keeps outside and unknown attribution distinct", () => {
    expect(projectSeriesKey(null)).toBe("outside");
    expect(projectSeriesKey(undefined)).toBe("unknown");
  });
});
