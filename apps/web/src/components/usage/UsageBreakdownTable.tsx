import {
  addUsageCostComponents,
  ZERO_USAGE_COST_COMPONENTS,
} from "@t3tools/shared/usageCostComponents";
import type { UsageProviderKind } from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  StarIcon,
} from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import { formatCount } from "@t3tools/shared/usageFormat";

import { cn } from "../../lib/utils";
import { Checkbox } from "../ui/checkbox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { USAGE_COLUMNS, UsageMetricCells, type UsageMetricColumn } from "./UsageColumns";
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

const NO_HIDDEN_COLUMNS: readonly UsageMetricColumn[] = [];

/** Colored rows are the chart legend; projects expand into their own threads. */
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
  hiddenColumns = NO_HIDDEN_COLUMNS,
  favoriteProjects,
  onToggleFavorite,
  renderThreads,
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
  readonly hiddenColumns?: readonly UsageMetricColumn[];
  readonly favoriteProjects?: readonly string[];
  readonly onToggleFavorite?: (key: string) => void;
  readonly renderThreads?: (key: string, columns: readonly UsageMetricColumn[]) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const sorted = useMemo(() => {
    const ordered = sortBreakdownRows(rows, sort, metric);
    const favorites = new Set(favoriteProjects);
    return [
      ...ordered.filter((row) => favorites.has(row.key)),
      ...ordered.filter((row) => !favorites.has(row.key)),
    ];
  }, [rows, sort, metric, favoriteProjects]);
  const columns = USAGE_COLUMNS.filter(
    ({ key }) =>
      key !== (metric === "cost" ? "tokens" : "cost") &&
      !hiddenColumns.includes(key) &&
      (key !== "sessions" || showSessions),
  );
  const columnKeys = columns.map(({ key }) => key);
  const shown = rows.filter((row) => !hidden.has(row.key));
  const hiddenCount = rows.length - shown.length;
  const sum = (key: "inputTokens" | "outputTokens" | "cacheReadTokens" | "sessions") =>
    shown.some((row) => row[key] == null)
      ? null
      : shown.reduce((total, row) => total + (row[key] ?? 0), 0);
  const shownTotals = {
    componentCosts: shown.reduce(
      (total, row) => addUsageCostComponents(total, row.componentCosts),
      ZERO_USAGE_COST_COMPONENTS,
    ),
    costUsd: shown.reduce((total, row) => total + row.costUsd, 0),
    totalTokens: shown.reduce((total, row) => total + row.totalTokens, 0),
    share: shown.reduce((total, row) => total + row.share, 0),
    cacheWriteTokens: shown.reduce((total, row) => total + row.cacheWriteTokens, 0),
    cacheWriteUsd: shown.some((row) => row.cacheWriteTokens > 0 && row.cacheWriteUsd === null)
      ? null
      : shown.reduce((total, row) => total + (row.cacheWriteUsd ?? 0), 0),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    sessions: sum("sessions"),
  };
  return (
    <div className="@container min-w-0 overflow-x-auto">
      <table className="w-full text-sm" aria-label={ariaLabel}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="w-10 min-w-10 py-2 pr-4 pl-2 text-left">
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
              className="min-w-64"
            />
            {columns.map(({ key, label }) => (
              <SortableHeader
                key={key}
                column={key}
                label={label}
                sort={sort}
                onSort={onSort}
                className="px-2 whitespace-nowrap"
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2} className="py-6 text-center text-muted-foreground">
                No activity in this window.
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const isHidden = hidden.has(row.key);
              const favorite = favoriteProjects?.includes(row.key) ?? false;
              const open = expanded.has(row.key);
              const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
              const canExpand = renderThreads !== undefined && row.key !== "unknown";
              const Mark =
                row.provider === undefined ? null : PROVIDER_PRESENTATION[row.provider].mark;
              return (
                <Fragment key={row.key}>
                  <tr
                    onPointerEnter={() => onActiveKeyChange(row.key)}
                    onPointerLeave={() => onActiveKeyChange(null)}
                    className={cn(
                      "border-b border-border/50",
                      activeKey === row.key && "bg-muted/60",
                      isHidden && "text-muted-foreground",
                    )}
                  >
                    <td className="w-10 min-w-10 py-2 pr-4 pl-2">
                      <Checkbox
                        checked={!isHidden}
                        onCheckedChange={() => onToggleHidden(row.key)}
                        aria-label={`${isHidden ? "Show" : "Hide"} ${row.label}`}
                      />
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2 pr-4">
                        {onToggleFavorite ? (
                          <button
                            type="button"
                            aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${row.label}`}
                            aria-pressed={favorite}
                            onClick={() => onToggleFavorite(row.key)}
                            className={cn(
                              "shrink-0 rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              favorite
                                ? "text-amber-500"
                                : "text-muted-foreground/50 hover:text-amber-500",
                            )}
                          >
                            <StarIcon
                              aria-hidden
                              className="size-3.5"
                              fill={favorite ? "currentColor" : "none"}
                            />
                          </button>
                        ) : null}
                        <span
                          aria-hidden
                          className={cn(
                            "size-2.5 shrink-0 rounded-[3px]",
                            isHidden && "opacity-30",
                          )}
                          style={{ backgroundColor: row.color }}
                        />
                        {Mark ? (
                          <Mark aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                        {canExpand ? (
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={`${open ? "Collapse" : "Expand"} ${row.label} threads`}
                            onClick={() =>
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(row.key)) next.delete(row.key);
                                else next.add(row.key);
                                return next;
                              })
                            }
                            className={cn(
                              "flex min-w-0 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              isHidden && "line-through",
                            )}
                          >
                            <RowLabel label={row.label} />
                            <Chevron
                              aria-hidden
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                          </button>
                        ) : (
                          <RowLabel label={row.label} />
                        )}
                      </div>
                    </td>
                    <UsageMetricCells
                      metric={metric}
                      row={row}
                      columns={columnKeys}
                      color={row.color}
                      muted={isHidden}
                    />
                  </tr>
                  {canExpand && open ? renderThreads(row.key, columnKeys) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
        {rows.length > 0 ? (
          <tfoot>
            <tr className="text-xs text-muted-foreground">
              <td />
              <td className="py-3">
                {hiddenCount > 0
                  ? `Shown, ${formatCount(shown.length)} of ${formatCount(rows.length)}`
                  : "Total"}
              </td>
              <UsageMetricCells metric={metric} row={shownTotals} columns={columnKeys} />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function RowLabel({ label }: { readonly label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="block max-w-64 truncate" />}>{label}</TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
