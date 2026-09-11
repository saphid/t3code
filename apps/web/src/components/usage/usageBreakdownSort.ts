import type { BreakdownSort } from "./usagePagePreferences";
import type { UsageStackMetric } from "./UsageStackedChart";

export type BreakdownColumn = BreakdownSort["column"];

/** The fields every breakdown table (projects, providers, models, threads) can sort on. */
export interface SortableBreakdownRow {
  readonly label: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly share: number;
  readonly cacheWriteTokens: number;
  /** `null` when cache writes exist but could not be priced. */
  readonly cacheWriteUsd: number | null;
  /** `null` when the dimension does not count sessions. */
  readonly sessions: number | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly cacheReadTokens?: number | null;
}

/** Until the user picks a column, rows follow the metric the page is showing. */
export function defaultBreakdownSort(
  metric: UsageStackMetric,
  hiddenColumns?: readonly BreakdownColumn[],
): BreakdownSort {
  const column = metric === "cost" ? "cost" : "tokens";
  return hiddenColumns?.includes(column)
    ? { column: "name", direction: "asc" }
    : { column, direction: "desc" };
}

/** Clicking the active column flips it; a new column starts in its natural direction. */
export function toggleBreakdownSort(
  current: BreakdownSort,
  column: BreakdownColumn,
): BreakdownSort {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: column === "name" ? "asc" : "desc" };
}

function sortValue(row: SortableBreakdownRow, column: BreakdownColumn): number | string | null {
  switch (column) {
    case "name":
      return row.label;
    case "cost":
      return row.costUsd;
    case "tokens":
      return row.totalTokens;
    case "share":
      return row.share;
    case "cacheWrites":
      return row.cacheWriteTokens;
    case "sessions":
      return row.sessions;
    case "input":
      return row.inputTokens ?? null;
    case "output":
      return row.outputTokens ?? null;
    case "cacheReads":
      return row.cacheReadTokens ?? null;
  }
}

/**
 * Orders rows for display. Rows with no value for the column (unpriced cache
 * components, dimensions without sessions) sink to the bottom in either direction,
 * and ties keep their incoming order so re-sorting never shuffles equal rows.
 */
export function sortBreakdownRows<T extends SortableBreakdownRow>(
  rows: readonly T[],
  sort: BreakdownSort,
): readonly T[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = sortValue(left.row, sort.column);
      const b = sortValue(right.row, sort.column);
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      const comparison =
        typeof a === "string" && typeof b === "string"
          ? a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
          : Number(a) - Number(b);
      return comparison === 0 ? left.index - right.index : comparison * sign;
    })
    .map((entry) => entry.row);
}
