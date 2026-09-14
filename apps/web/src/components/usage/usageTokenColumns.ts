import type { UsageCostComponents } from "@t3tools/contracts";
import {
  addUsageCostComponents,
  ZERO_USAGE_COST_COMPONENTS,
} from "@t3tools/shared/usageCostComponents";
import type { UsageTimelineCell } from "@t3tools/shared/usageMerge";

/** Component counts use the same bounded, deduplicated cells as the chart. */
export function usageTokenColumns(
  cells: readonly UsageTimelineCell[],
  keyFor: (cell: UsageTimelineCell) => string,
) {
  const result = new Map<
    string,
    {
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
      componentCosts: UsageCostComponents;
    }
  >();
  for (const cell of cells) {
    const key = keyFor(cell);
    const totals = result.get(key) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      componentCosts: ZERO_USAGE_COST_COMPONENTS,
    };
    if (cell.totals === undefined) {
      totals.inputTokens = totals.outputTokens = totals.cacheReadTokens = null;
    } else {
      if (totals.inputTokens !== null) totals.inputTokens += cell.totals.uncachedInputTokens;
      if (totals.outputTokens !== null) totals.outputTokens += cell.totals.outputTokens;
      if (totals.cacheReadTokens !== null) totals.cacheReadTokens += cell.totals.cachedInputTokens;
    }
    totals.componentCosts = addUsageCostComponents(totals.componentCosts, cell.componentCosts);
    result.set(key, totals);
  }
  return result;
}
