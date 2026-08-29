import { describe, expect, it } from "@effect/vitest";

import { cacheSavingsUsd, parseRateTable, priceUsage } from "./usagePricing.ts";

const canonicalFable = {
  input_cost_per_token: 1e-5,
  output_cost_per_token: 5e-5,
  cache_read_input_token_cost: 1e-6,
  cache_creation_input_token_cost: 1.25e-5,
};
const resellerFable = {
  input_cost_per_token: 1e-5,
  output_cost_per_token: 5e-5,
};

describe("parseRateTable", () => {
  it("keeps the canonical entry when a prefixed entry follows it", () => {
    const table = parseRateTable({
      "claude-fable-5": canonicalFable,
      "deepinfra/anthropic/claude-fable-5": resellerFable,
    });

    expect(table.get("claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
    expect(table.get("claude-fable-5")?.cacheCreationCostPerToken).toBe(1.25e-5);
  });

  it("keeps the canonical entry when a prefixed entry precedes it", () => {
    const table = parseRateTable({
      "deepinfra/anthropic/claude-fable-5": resellerFable,
      "claude-fable-5": canonicalFable,
    });

    expect(table.get("claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
  });

  it("keeps canonical base rates when a prefixed entry prices differently", () => {
    const table = parseRateTable({
      "gemini-2.5-pro": { input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5 },
      "vercel_ai_gateway/gemini-2.5-pro": {
        input_cost_per_token: 2.5e-6,
        output_cost_per_token: 2e-5,
        cache_read_input_token_cost: 2.5e-7,
      },
    });

    expect(table.get("gemini-2.5-pro")?.inputCostPerToken).toBe(1.25e-6);
  });

  it("fills a name that only exists as a prefixed entry", () => {
    const table = parseRateTable({
      "vertex_ai/some-prefixed-only-model": {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 9e-6,
      },
    });

    expect(table.get("some-prefixed-only-model")?.inputCostPerToken).toBe(3e-6);
  });

  it("prices cached input as plain input when the canonical entry has no cache rates", () => {
    const table = parseRateTable({
      "gpt-realtime-mini": { input_cost_per_token: 6e-7, output_cost_per_token: 2.4e-6 },
    });

    expect(table.get("gpt-realtime-mini")?.cacheReadCostPerToken).toBe(6e-7);
  });

  it("treats a dot-prefixed name as its own canonical entry", () => {
    const table = parseRateTable({
      "claude-fable-5": canonicalFable,
      "us.anthropic.claude-fable-5": {
        input_cost_per_token: 1.1e-5,
        output_cost_per_token: 5.5e-5,
        cache_read_input_token_cost: 1.1e-6,
      },
    });

    expect(table.get("claude-fable-5")?.inputCostPerToken).toBe(1e-5);
    expect(table.get("us.anthropic.claude-fable-5")?.inputCostPerToken).toBe(1.1e-5);
  });
});

describe("pricing with a colliding table", () => {
  const table = parseRateTable({
    "claude-fable-5": canonicalFable,
    "deepinfra/anthropic/claude-fable-5": resellerFable,
  });
  const totals = {
    uncachedInputTokens: 1_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 10_000,
    outputTokens: 2_000,
    reasoningTokens: 0,
  };

  it("prices cache reads at the discounted rate", () => {
    const priced = priceUsage(table, "claude-fable-5", totals, null);

    expect(priced.costSource).toBe("modelPriced");
    expect(priced.costUsd).toBeCloseTo(1.235, 10);
  });

  it("reports cache savings separately", () => {
    expect(cacheSavingsUsd(table, "claude-fable-5", totals)).toBeCloseTo(9, 10);
  });
});
