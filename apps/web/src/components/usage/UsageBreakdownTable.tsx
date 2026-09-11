import type { UsageProviderKind } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useMemo } from "react";

import { formatCount, formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";

import { cn } from "../../lib/utils";
import { Checkbox } from "../ui/checkbox";
import { UsageCacheWriteCell } from "./UsageCacheWriteCell";
import {
  sortBreakdownRows,
  type BreakdownColumn,
  type SortableBreakdownRow,
} from "./usageBreakdownSort";
import type { BreakdownSort } from "./usagePagePreferences";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import type { UsageStackMetric } from "./UsageStackedChart";

export interface BreakdownTableRow extends SortableBreakdownRow {
  /** Matches the chart series key so hover and hide stay in sync. */
  readonly key: string;
  readonly color: string;
  /** Set for model rows so the provider mark can sit beside the name. */
  readonly provider?: UsageProviderKind;
}

/**
 * Column header that sorts on click. Shared by the dimension tables and the
 * thread table so every breakdown sorts the same way.
 */
export function SortableHeader({
  column,
  label,
  sort,
  onSort,
  align = "right",
  className,
}: {
  readonly column: BreakdownColumn;
  readonly label: string;
  readonly sort: BreakdownSort;
  readonly onSort: (column: BreakdownColumn) => void;
  readonly align?: "left" | "right";
  readonly className?: string;
}) {
  const active = sort.column === column;
  const Arrow = active && sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("py-2 font-normal", align === "right" ? "text-right" : "text-left", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "group inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        <Arrow
          aria-hidden
          className={cn(
            "size-3 shrink-0",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-50",
          )}
        />
      </button>
    </th>
  );
}

/**
 * One sortable breakdown table for a dimension (projects, providers, or
 * models). Rows share keys and colors with the chart: hovering a row highlights
 * its series, and the checkbox removes it from the chart and the shown totals.
 */
export function UsageBreakdownTable({
  rows,
  nameLabel,
  metric,
  sort,
  onSort,
  hidden,
  onToggleHidden,
  onSetAllHidden,
  activeKey,
  onActiveKeyChange,
  showSessions = false,
  ariaLabel,
}: {
  readonly rows: readonly BreakdownTableRow[];
  readonly nameLabel: string;
  readonly metric: UsageStackMetric;
  readonly sort: BreakdownSort;
  readonly onSort: (column: BreakdownColumn) => void;
  readonly hidden: ReadonlySet<string>;
  readonly onToggleHidden: (key: string) => void;
  readonly onSetAllHidden: (hidden: boolean) => void;
  readonly activeKey: string | null;
  readonly onActiveKeyChange: (key: string | null) => void;
  readonly showSessions?: boolean;
  readonly ariaLabel: string;
}) {
  const sorted = useMemo(() => sortBreakdownRows(rows, sort), [rows, sort]);
  const shown = useMemo(() => rows.filter((row) => !hidden.has(row.key)), [hidden, rows]);
  const hiddenCount = rows.length - shown.length;
  const shownTotals = useMemo(() => {
    let costUsd = 0;
    let totalTokens = 0;
    let share = 0;
    let cacheWriteTokens = 0;
    let cacheWriteUsd: number | null = 0;
    let sessions = 0;
    for (const row of shown) {
      costUsd += row.costUsd;
      totalTokens += row.totalTokens;
      share += row.share;
      cacheWriteTokens += row.cacheWriteTokens;
      if (row.cacheWriteTokens > 0 && row.cacheWriteUsd === null) cacheWriteUsd = null;
      else if (cacheWriteUsd !== null) cacheWriteUsd += row.cacheWriteUsd ?? 0;
      sessions += row.sessions ?? 0;
    }
    return { costUsd, totalTokens, share, cacheWriteTokens, cacheWriteUsd, sessions };
  }, [shown]);
  const columnCount = showSessions ? 7 : 6;
  const costEmphasis = metric === "cost" ? "text-foreground" : "text-muted-foreground";
  const tokenEmphasis = metric === "tokens" ? "text-foreground" : "text-muted-foreground";

  return (
    <table className="w-full table-fixed text-sm" aria-label={ariaLabel}>
      <colgroup>
        <col className="w-9" />
        <col />
        <col className="w-[13%]" />
        <col className="w-[12%]" />
        <col className="w-[17%]" />
        <col className="w-[14%]" />
        {showSessions ? <col className="w-[11%]" /> : null}
      </colgroup>
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th scope="col" className="py-2 text-left">
            <Checkbox
              checked={hiddenCount === 0 && rows.length > 0}
              indeterminate={hiddenCount > 0 && hiddenCount < rows.length}
              onCheckedChange={(checked) => onSetAllHidden(!checked)}
              aria-label={hiddenCount === 0 ? "Hide all rows" : "Show all rows"}
              disabled={rows.length === 0}
            />
          </th>
          <SortableHeader
            column="name"
            label={nameLabel}
            sort={sort}
            onSort={onSort}
            align="left"
          />
          <SortableHeader column="cost" label="Cost" sort={sort} onSort={onSort} />
          <SortableHeader column="tokens" label="Tokens" sort={sort} onSort={onSort} />
          <SortableHeader column="share" label="Share" sort={sort} onSort={onSort} />
          <SortableHeader column="cacheWrites" label="Cache writes" sort={sort} onSort={onSort} />
          {showSessions ? (
            <SortableHeader column="sessions" label="Sessions" sort={sort} onSort={onSort} />
          ) : null}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={columnCount} className="py-6 text-center text-muted-foreground">
              No activity in this window.
            </td>
          </tr>
        ) : (
          sorted.map((row) => {
            const isHidden = hidden.has(row.key);
            const highlighted = activeKey === row.key;
            const Mark =
              row.provider === undefined ? null : PROVIDER_PRESENTATION[row.provider].mark;
            return (
              <tr
                key={row.key}
                onPointerEnter={() => onActiveKeyChange(row.key)}
                onPointerLeave={() => onActiveKeyChange(null)}
                className={cn(
                  "border-b border-border/50",
                  highlighted && "bg-muted/60",
                  isHidden && "text-muted-foreground",
                  activeKey !== null && !highlighted && "opacity-60",
                )}
              >
                <td className="py-1.5">
                  <Checkbox
                    checked={!isHidden}
                    onCheckedChange={() => onToggleHidden(row.key)}
                    aria-label={`${isHidden ? "Show" : "Hide"} ${row.label}`}
                  />
                </td>
                <td className="py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={cn("size-2.5 shrink-0 rounded-[3px]", isHidden && "opacity-30")}
                      style={{ backgroundColor: row.color }}
                    />
                    {Mark === null ? null : (
                      <Mark className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className={cn("truncate", isHidden && "line-through")}>{row.label}</span>
                  </span>
                </td>
                <td className={cn("py-1.5 text-right tabular-nums", costEmphasis)}>
                  {formatUsd(row.costUsd)}
                </td>
                <td className={cn("py-1.5 text-right tabular-nums", tokenEmphasis)}>
                  {formatTokens(row.totalTokens)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  <ShareCell share={row.share} color={row.color} muted={isHidden} />
                </td>
                <UsageCacheWriteCell
                  cacheWriteTokens={row.cacheWriteTokens}
                  cacheWriteUsd={row.cacheWriteUsd}
                />
                {showSessions ? (
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {row.sessions === null ? "-" : formatCount(row.sessions)}
                  </td>
                ) : null}
              </tr>
            );
          })
        )}
      </tbody>
      {rows.length > 1 ? (
        <tfoot>
          <tr className="text-xs text-muted-foreground">
            <td />
            <td className="py-2">
              {hiddenCount > 0
                ? `Shown, ${formatCount(shown.length)} of ${formatCount(rows.length)}`
                : "Total"}
            </td>
            <td className="py-2 text-right tabular-nums">{formatUsd(shownTotals.costUsd)}</td>
            <td className="py-2 text-right tabular-nums">
              {formatTokens(shownTotals.totalTokens)}
            </td>
            <td className="py-2 text-right tabular-nums">{formatPercent(shownTotals.share)}</td>
            <UsageCacheWriteCell
              cacheWriteTokens={shownTotals.cacheWriteTokens}
              cacheWriteUsd={shownTotals.cacheWriteUsd}
            />
            {showSessions ? (
              <td className="py-2 text-right tabular-nums">{formatCount(shownTotals.sessions)}</td>
            ) : null}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/** Percent with a small proportional bar so the eye can rank rows without reading. */
function ShareCell({
  share,
  color,
  muted,
}: {
  readonly share: number;
  readonly color: string;
  readonly muted: boolean;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", muted && "opacity-30")}
          style={{ width: `${Math.min(100, Math.max(0, share * 100))}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-12 text-right">{formatPercent(share)}</span>
    </span>
  );
}
