import { Columns3Icon } from "lucide-react";
import { formatCount, formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";

import { Button } from "../ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import type { BreakdownColumn, SortableBreakdownRow } from "./usageBreakdownSort";

export type UsageMetricColumn = Exclude<BreakdownColumn, "name">;

export const USAGE_COLUMNS: readonly { key: UsageMetricColumn; label: string }[] = [
  { key: "cost", label: "Cost" },
  { key: "share", label: "Share" },
  { key: "tokens", label: "Tokens" },
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheReads", label: "Cache reads" },
  { key: "cacheWrites", label: "Cache writes" },
  { key: "sessions", label: "Sessions" },
];

export function UsageColumns({
  hidden,
  onChange,
  showSessions = false,
}: {
  readonly hidden: readonly UsageMetricColumn[];
  readonly onChange: (hidden: readonly UsageMetricColumn[]) => void;
  readonly showSessions?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="outline" />}>
        <Columns3Icon aria-hidden className="size-3.5" /> Columns
      </MenuTrigger>
      <MenuPopup align="end">
        {USAGE_COLUMNS.filter(({ key }) => key !== "sessions" || showSessions).map(
          ({ key, label }) => (
            <MenuCheckboxItem
              key={key}
              checked={!hidden.includes(key)}
              closeOnClick={false}
              onCheckedChange={(checked) =>
                onChange(checked ? hidden.filter((column) => column !== key) : [...hidden, key])
              }
            >
              {label}
            </MenuCheckboxItem>
          ),
        )}
      </MenuPopup>
    </Menu>
  );
}

/** Shared cells keep project totals and their nested threads aligned. */
export function UsageMetricCells({
  row,
  columns,
  color,
  muted = false,
}: {
  readonly row: Omit<SortableBreakdownRow, "label">;
  readonly columns: readonly UsageMetricColumn[];
  readonly color?: string;
  readonly muted?: boolean;
}) {
  return columns.map((column) => {
    let value;
    switch (column) {
      case "cost":
        value = formatUsd(row.costUsd);
        break;
      case "tokens":
        value = formatTokens(row.totalTokens);
        break;
      case "input":
        value = row.inputTokens == null ? "Unavailable" : formatTokens(row.inputTokens);
        break;
      case "output":
        value = row.outputTokens == null ? "Unavailable" : formatTokens(row.outputTokens);
        break;
      case "cacheReads":
        value = row.cacheReadTokens == null ? "Unavailable" : formatTokens(row.cacheReadTokens);
        break;
      case "cacheWrites":
        value = (
          <span>
            {formatTokens(row.cacheWriteTokens)}
            <span className="block text-[10px] text-muted-foreground">
              {row.cacheWriteUsd === null ? "Cost unavailable" : formatUsd(row.cacheWriteUsd)}
            </span>
          </span>
        );
        break;
      case "sessions":
        value = row.sessions === null ? "Unavailable" : formatCount(row.sessions);
        break;
      case "share":
        value = (
          <span className="inline-flex items-center gap-2">
            {color ? (
              <span aria-hidden className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{
                    backgroundColor: color,
                    opacity: muted ? 0.3 : 1,
                    width: `${Math.min(100, Math.max(0, row.share * 100))}%`,
                  }}
                />
              </span>
            ) : null}
            {formatPercent(row.share)}
          </span>
        );
        break;
    }
    return (
      <td key={column} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
        {value}
      </td>
    );
  });
}
