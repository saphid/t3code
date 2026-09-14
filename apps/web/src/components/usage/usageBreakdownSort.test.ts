import { describe, expect, it } from "vite-plus/test";

import {
  breakdownSortForMetric,
  defaultBreakdownSort,
  sortBreakdownRows,
  toggleBreakdownSort,
  type SortableBreakdownRow,
} from "./usageBreakdownSort";

const row = (
  label: string,
  overrides: Partial<SortableBreakdownRow> = {},
): SortableBreakdownRow & { readonly key: string } => ({
  key: label,
  label,
  costUsd: 0,
  totalTokens: 0,
  share: 0,
  cacheWriteTokens: 0,
  cacheWriteUsd: 0,
  sessions: null,
  ...overrides,
});

describe("defaultBreakdownSort", () => {
  it("moves total sorts with the visible units but preserves component sorts", () => {
    expect(breakdownSortForMetric({ column: "cost", direction: "asc" }, "tokens")).toEqual({
      column: "tokens",
      direction: "asc",
    });
    expect(breakdownSortForMetric({ column: "output", direction: "desc" }, "cost")).toEqual({
      column: "output",
      direction: "desc",
    });
  });
  it("follows the metric the page is showing", () => {
    expect(defaultBreakdownSort("cost")).toEqual({ column: "cost", direction: "desc" });
    expect(defaultBreakdownSort("tokens")).toEqual({ column: "tokens", direction: "desc" });
  });
});

describe("toggleBreakdownSort", () => {
  it("flips direction on the active column and starts numbers descending", () => {
    const cost = { column: "cost", direction: "desc" } as const;
    expect(toggleBreakdownSort(cost, "cost")).toEqual({ column: "cost", direction: "asc" });
    expect(toggleBreakdownSort(cost, "tokens")).toEqual({ column: "tokens", direction: "desc" });
  });

  it("starts names ascending", () => {
    expect(toggleBreakdownSort({ column: "cost", direction: "desc" }, "name")).toEqual({
      column: "name",
      direction: "asc",
    });
  });
});

describe("sortBreakdownRows", () => {
  it.each(["input", "output", "cacheReads", "cacheWrites"] as const)(
    "sorts %s in the selected units",
    (column) => {
      const rows = [
        row("More tokens", {
          inputTokens: 100,
          outputTokens: 100,
          cacheReadTokens: 100,
          cacheWriteTokens: 100,
          cacheWriteUsd: 1,
          componentCosts: { inputUsd: 1, outputUsd: 1, cacheReadUsd: 1 },
        }),
        row("More dollars", {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadTokens: 10,
          cacheWriteTokens: 10,
          cacheWriteUsd: 9,
          componentCosts: { inputUsd: 9, outputUsd: 9, cacheReadUsd: 9 },
        }),
        row("Unavailable", { cacheWriteUsd: null }),
      ];
      const labels = (metric: "cost" | "tokens", direction: "asc" | "desc") =>
        sortBreakdownRows(rows, { column, direction }, metric).map((row) => row.label);
      expect(labels("cost", "desc")).toEqual(["More dollars", "More tokens", "Unavailable"]);
      expect(labels("cost", "asc")).toEqual(["More tokens", "More dollars", "Unavailable"]);
      expect(labels("tokens", "desc").slice(0, 2)).toEqual(["More tokens", "More dollars"]);
    },
  );
  const rows = [
    row("Orbit", { costUsd: 5, totalTokens: 50, cacheWriteTokens: 10, cacheWriteUsd: null }),
    row("atlas", { costUsd: 12, totalTokens: 20, cacheWriteTokens: 4, cacheWriteUsd: 0.4 }),
    row("Pipeline 2", { costUsd: 5, totalTokens: 90, cacheWriteTokens: 0, cacheWriteUsd: 0 }),
    row("Pipeline 10", { costUsd: 1, totalTokens: 5, cacheWriteTokens: 3, cacheWriteUsd: 0.1 }),
  ];
  const labels = (sorted: readonly { readonly label: string }[]) => sorted.map((r) => r.label);

  it("sorts numbers in both directions and keeps ties in their incoming order", () => {
    expect(labels(sortBreakdownRows(rows, { column: "cost", direction: "desc" }))).toEqual([
      "atlas",
      "Orbit",
      "Pipeline 2",
      "Pipeline 10",
    ]);
    expect(labels(sortBreakdownRows(rows, { column: "cost", direction: "asc" }))).toEqual([
      "Pipeline 10",
      "Orbit",
      "Pipeline 2",
      "atlas",
    ]);
  });

  it("sorts names case-insensitively with natural numbers", () => {
    expect(labels(sortBreakdownRows(rows, { column: "name", direction: "asc" }))).toEqual([
      "atlas",
      "Orbit",
      "Pipeline 2",
      "Pipeline 10",
    ]);
  });

  it("sorts cache-write token counts even when their price is unavailable", () => {
    expect(labels(sortBreakdownRows(rows, { column: "cacheWrites", direction: "desc" }))).toEqual([
      "Orbit",
      "atlas",
      "Pipeline 10",
      "Pipeline 2",
    ]);
    expect(labels(sortBreakdownRows(rows, { column: "cacheWrites", direction: "asc" }))).toEqual([
      "Pipeline 2",
      "Pipeline 10",
      "atlas",
      "Orbit",
    ]);
  });

  it("sorts component counts and sinks missing data in either direction", () => {
    const components = [
      row("Unknown"),
      row("Small", { inputTokens: 1 }),
      row("Large", { inputTokens: 9 }),
    ];
    expect(labels(sortBreakdownRows(components, { column: "input", direction: "desc" }))).toEqual([
      "Large",
      "Small",
      "Unknown",
    ]);
    expect(labels(sortBreakdownRows(components, { column: "input", direction: "asc" }))).toEqual([
      "Small",
      "Large",
      "Unknown",
    ]);
    expect(defaultBreakdownSort("cost", ["cost"])).toEqual({ column: "name", direction: "asc" });
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    sortBreakdownRows(rows, { column: "tokens", direction: "asc" });
    expect(rows).toEqual(copy);
  });
});
