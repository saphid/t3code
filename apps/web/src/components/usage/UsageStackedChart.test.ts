import { describe, expect, it } from "vite-plus/test";

import {
  autoGrouping,
  groupTimeline,
  groupedPointIndexAt,
  hoverSampleAt,
  projectSeriesKey,
  stackedAreaPath,
  timeTicks,
} from "./UsageStackedChart";

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

describe("chart geometry", () => {
  it("keeps half-hour hover steps inside a twelve-hour display bucket", () => {
    const sinceMs = Date.parse("2026-09-01T00:00:00.000Z");
    const untilMs = Date.parse("2026-09-02T00:00:00.000Z");

    const first = hoverSampleAt(245, 0, 960, sinceMs, untilMs, 30 * 60_000);
    const second = hoverSampleAt(265, 0, 960, sinceMs, untilMs, 30 * 60_000);

    expect(first?.startMs).toBe(Date.parse("2026-09-01T06:00:00.000Z"));
    expect(first?.x).toBeCloseTo(250);
    expect(second?.startMs).toBe(Date.parse("2026-09-01T06:30:00.000Z"));
    expect(second?.x).toBeCloseTo(270);
    expect(groupedPointIndexAt(first!.startMs, sinceMs, "12h", 2)).toBe(0);
    expect(groupedPointIndexAt(second!.startMs, sinceMs, "12h", 2)).toBe(0);
    expect(groupedPointIndexAt(Date.parse("2026-09-01T12:00:00.000Z"), sinceMs, "12h", 2)).toBe(1);
  });

  it("draws grouped stacked areas with shape-preserving curves", () => {
    const models = new Set(["codex\u0000gpt-5.6-sol", "claude\u0000claude-fable-5"]);
    const points = groupTimeline(
      cells,
      "projects",
      "cost",
      "30m",
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T01:00:00.000Z",
      models,
    );

    expect(
      stackedAreaPath(points, [{ key: "project:env:id:one", label: "One", color: "#fff" }], 0, 3),
    ).toContain(" C");
  });
});

describe("autoGrouping", () => {
  it("picks hourly for a day, six-hourly for a week, daily beyond ten days", () => {
    expect(autoGrouping("2026-09-10T08:00:00.000Z", "2026-09-11T08:00:00.000Z")).toBe("1h");
    expect(autoGrouping("2026-09-04T08:00:00.000Z", "2026-09-11T08:00:00.000Z")).toBe("6h");
    expect(autoGrouping("2026-08-12T08:00:00.000Z", "2026-09-11T08:00:00.000Z")).toBe("1d");
    expect(autoGrouping("2026-09-11T08:00:00.000Z", "2026-09-11T08:00:00.000Z")).toBe("1d");
  });
});

describe("timeTicks", () => {
  it("marks local midnights for a multi-day window", () => {
    const ticks = timeTicks(
      "2026-09-04T15:00:00.000Z",
      "2026-09-11T15:00:00.000Z",
      "America/Chicago",
    );
    expect(ticks.map((tick) => tick.label)).toEqual([
      "Sep 5",
      "Sep 6",
      "Sep 7",
      "Sep 8",
      "Sep 9",
      "Sep 10",
      "Sep 11",
    ]);
    // Chicago midnight in September is 05:00 UTC.
    expect(new Date(ticks[0]!.ms).toISOString()).toBe("2026-09-05T05:00:00.000Z");
  });

  it("thins long windows to at most eight labels", () => {
    const ticks = timeTicks("2026-06-13T00:00:00.000Z", "2026-09-11T00:00:00.000Z", "UTC");
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.length).toBeGreaterThan(4);
  });

  it("uses six-hour marks inside a day", () => {
    const ticks = timeTicks("2026-09-10T08:00:00.000Z", "2026-09-11T08:00:00.000Z", "UTC");
    expect(ticks.map((tick) => tick.ms)).toEqual([
      Date.parse("2026-09-10T14:00:00.000Z"),
      Date.parse("2026-09-10T20:00:00.000Z"),
      Date.parse("2026-09-11T02:00:00.000Z"),
    ]);
  });
});
