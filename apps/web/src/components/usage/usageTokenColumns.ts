import type { UsageTimelineCell } from "@t3tools/shared/usageMerge";

/** Component counts use the same bounded, deduplicated cells as the chart. */
export function usageTokenColumns(
  cells: readonly UsageTimelineCell[],
  keyFor: (cell: UsageTimelineCell) => string,
) {
  const result = new Map<
    string,
    { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null }
  >();
  for (const cell of cells) {
    const key = keyFor(cell);
    const totals = result.get(key) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    if (cell.totals === undefined) {
      totals.inputTokens = totals.outputTokens = totals.cacheReadTokens = null;
    } else {
      if (totals.inputTokens !== null) totals.inputTokens += cell.totals.uncachedInputTokens;
      if (totals.outputTokens !== null) totals.outputTokens += cell.totals.outputTokens;
      if (totals.cacheReadTokens !== null) totals.cacheReadTokens += cell.totals.cachedInputTokens;
    }
    result.set(key, totals);
  }
  return result;
}
