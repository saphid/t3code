import { describe, expect, it } from "@effect/vitest";

import { scenarioRunPlan } from "./runner.ts";

describe("scenario run plan", () => {
  it("discards one complete fresh environment before retaining five samples", () => {
    expect(scenarioRunPlan(true, 5, 1)).toEqual([false, true, true, true, true, true]);
  });

  it("preserves legacy warmup defaults", () => {
    expect(scenarioRunPlan(true, 5)).toEqual([true, true, true, true, true]);
    expect(scenarioRunPlan(false, 5)).toEqual([false, true, true, true, true, true]);
  });
});
