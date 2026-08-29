import { describe, expect, it } from "vite-plus/test";

import { retainKnownTokenUsageMaximum, shouldEmitTokenUsage } from "./tokenUsage.ts";

describe("shouldEmitTokenUsage", () => {
  it("accepts forward progress and a delayed context maximum", () => {
    expect(shouldEmitTokenUsage(undefined, { usedTokens: 100 })).toBe(true);
    expect(shouldEmitTokenUsage({ usedTokens: 100 }, { usedTokens: 101 })).toBe(true);
    expect(shouldEmitTokenUsage({ usedTokens: 101 }, { usedTokens: 101, maxTokens: 200_000 })).toBe(
      true,
    );
  });

  it("rejects duplicate and older snapshots", () => {
    expect(shouldEmitTokenUsage({ usedTokens: 101 }, { usedTokens: 101 })).toBe(false);
    expect(shouldEmitTokenUsage({ usedTokens: 101 }, { usedTokens: 100 })).toBe(false);
    expect(
      shouldEmitTokenUsage(
        { usedTokens: 100, maxTokens: 1_000 },
        { usedTokens: 110, maxTokens: 2_000 },
      ),
    ).toBe(false);
  });

  it("retains a known maximum when a later update omits capacity", () => {
    expect(
      retainKnownTokenUsageMaximum({ usedTokens: 100, maxTokens: 200_000 }, { usedTokens: 101 }),
    ).toEqual({ usedTokens: 101, maxTokens: 200_000 });
  });
});
