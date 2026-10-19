import { describe, expect, it } from "@effect/vitest";

import { summarize } from "./stats.ts";

describe("summarize", () => {
  it("reports exact values for a single sample", () => {
    const summary = summarize([42]);
    expect(summary.median).toBe(42);
    expect(summary.ci95).toEqual([42, 42]);
    expect(summary.stddev).toBe(0);
  });

  it("computes median for even counts", () => {
    expect(summarize([1, 2, 3, 4]).median).toBe(2.5);
  });

  it("produces a confidence interval that brackets the mean", () => {
    const summary = summarize([100, 110, 90, 105, 95]);
    expect(summary.mean).toBe(100);
    expect(summary.ci95[0]).toBeLessThan(100);
    expect(summary.ci95[1]).toBeGreaterThan(100);
    expect(summary.min).toBe(90);
    expect(summary.max).toBe(110);
  });

  it("rejects empty input", () => {
    expect(() => summarize([])).toThrow();
  });
});
