import type { UsageCostComponents } from "@t3tools/contracts";

export const ZERO_USAGE_COST_COMPONENTS: UsageCostComponents = {
  inputUsd: 0,
  outputUsd: 0,
  cacheReadUsd: 0,
};

/** Missing components stay unavailable when combined with priced usage. */
export function addUsageCostComponents(
  left: UsageCostComponents | undefined,
  right: UsageCostComponents | undefined,
): UsageCostComponents {
  const sum = (key: keyof UsageCostComponents) =>
    left?.[key] == null || right?.[key] == null ? null : left[key] + right[key];
  return {
    inputUsd: sum("inputUsd"),
    outputUsd: sum("outputUsd"),
    cacheReadUsd: sum("cacheReadUsd"),
  };
}
