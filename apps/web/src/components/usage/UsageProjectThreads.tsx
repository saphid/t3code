import {
  USAGE_THREAD_MODEL_FILTER_SINCE,
  type UsageThreadBreakdownInput,
  type UsageProviderKind,
} from "@t3tools/contracts";
import type { EnvironmentProviderContribution } from "@t3tools/shared/usageMerge";
import { useMemo, useState } from "react";

import { filterProviderContributionsForProject, useUsageThreads } from "../../state/usage";
import { SortableHeader } from "./UsageBreakdownTable";
import { USAGE_COLUMNS, UsageMetricCells, type UsageMetricColumn } from "./UsageColumns";
import { ThreadRowGroup } from "./UsageThreadTable";
import { sortBreakdownRows, type BreakdownColumn } from "./usageBreakdownSort";
import type { BreakdownSort } from "./usagePagePreferences";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { modelSeriesKey, type UsageStackMetric } from "./UsageStackedChart";

/** Fetches only an expanded project's threads, with filters scoped to this project. */
export function UsageProjectThreads({
  input,
  projectLabel,
  providerContributions,
  summaryFailedEnvironments,
  models,
  columns,
  metric,
  sort,
  onSort,
}: {
  readonly input: UsageThreadBreakdownInput;
  readonly projectLabel: string;
  readonly providerContributions: readonly EnvironmentProviderContribution[];
  readonly summaryFailedEnvironments: number;
  readonly models: readonly { provider: UsageProviderKind; model: string }[];
  readonly columns: readonly UsageMetricColumn[];
  readonly metric: UsageStackMetric;
  readonly sort: BreakdownSort;
  readonly onSort: (column: BreakdownColumn) => void;
}) {
  const [provider, setProvider] = useState<UsageProviderKind | "all">("all");
  const [selectedModel, setSelectedModel] = useState("");
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const contributions = useMemo(
    () =>
      filterProviderContributionsForProject(input.projectKey, providerContributions)
        .map((entry) => ({
          ...entry,
          providers: entry.providers.filter((value) => provider === "all" || provider === value),
        }))
        .filter((entry) => entry.providers.length > 0),
    [input.projectKey, providerContributions, provider],
  );
  const canFilterModels = contributions.every(
    (entry) => entry.contractVersion >= USAGE_THREAD_MODEL_FILTER_SINCE,
  );
  const model = canFilterModels
    ? models.find(
        (entry) =>
          modelSeriesKey(entry.provider, entry.model) === selectedModel &&
          (provider === "all" || entry.provider === provider),
      )
    : undefined;
  const { rows, truncatedRows, isPending, failedEnvironments } = useUsageThreads(
    { ...input, ...(model ? { model } : {}) },
    contributions,
  );
  const sorted = useMemo(() => {
    const total = rows.reduce(
      (sum, row) =>
        sum +
        (metric === "cost"
          ? row.costUsd
          : row.totals.uncachedInputTokens +
            row.totals.cachedInputTokens +
            row.totals.cacheCreationTokens +
            row.totals.outputTokens),
      0,
    );
    return sortBreakdownRows(
      rows.map((row) => {
        const totalTokens =
          row.totals.uncachedInputTokens +
          row.totals.cachedInputTokens +
          row.totals.cacheCreationTokens +
          row.totals.outputTokens;
        return {
          row,
          label: row.title,
          costUsd: row.costUsd,
          totalTokens,
          share: total === 0 ? 0 : (metric === "cost" ? row.costUsd : totalTokens) / total,
          cacheWriteTokens: row.totals.cacheCreationTokens,
          cacheWriteUsd: row.cacheWriteUsd,
          inputTokens: row.totals.uncachedInputTokens,
          outputTokens: row.totals.outputTokens,
          cacheReadTokens: row.totals.cachedInputTokens,
          sessions: row.sessions,
        };
      }),
      sort,
    );
  }, [rows, metric, sort]);
  const providers = [...new Set(models.map((entry) => entry.provider))];
  const columnCount = columns.length + 2;
  const unavailable = failedEnvironments + summaryFailedEnvironments;
  const filtered = provider !== "all" || model !== undefined;
  const filteredTotal = sorted.reduce(
    (total, row) => ({
      costUsd: total.costUsd + row.costUsd,
      totalTokens: total.totalTokens + row.totalTokens,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
      cacheWriteUsd:
        total.cacheWriteUsd === null || row.cacheWriteUsd === null
          ? null
          : total.cacheWriteUsd + row.cacheWriteUsd,
      sessions: total.sessions + row.sessions,
      share: total.share + row.share,
    }),
    {
      costUsd: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWriteUsd: 0 as number | null,
      sessions: 0,
      share: 0,
    },
  );
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={columnCount} className="px-8 py-3">
          <div className="flex w-[calc(100cqw-4rem)] max-w-full flex-wrap items-center gap-2 text-xs">
            <span className="mr-auto font-medium">Threads in {projectLabel}</span>
            <select
              aria-label={`Thread provider in ${projectLabel}`}
              className="h-8 max-w-52 rounded-md border border-input bg-background px-2"
              value={provider}
              onChange={(event) => {
                const next = providers.find((value) => value === event.target.value) ?? "all";
                setProvider(next);
                setSelectedModel("");
              }}
            >
              <option value="all">All providers</option>
              {providers.map((value) => (
                <option key={value} value={value}>
                  {PROVIDER_PRESENTATION[value].label}
                </option>
              ))}
            </select>
            <select
              aria-label={`Thread model in ${projectLabel}`}
              className="h-8 max-w-60 rounded-md border border-input bg-background px-2 disabled:opacity-50"
              value={model ? selectedModel : ""}
              disabled={!canFilterModels}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              <option value="">All models</option>
              {models
                .filter((entry) => provider === "all" || entry.provider === provider)
                .map((entry) => (
                  <option
                    key={modelSeriesKey(entry.provider, entry.model)}
                    value={modelSeriesKey(entry.provider, entry.model)}
                  >
                    {entry.model} · {PROVIDER_PRESENTATION[entry.provider].label}
                  </option>
                ))}
            </select>
            {filtered ? (
              <button
                type="button"
                className="rounded-sm px-2 py-1 underline underline-offset-2"
                onClick={() => {
                  setProvider("all");
                  setSelectedModel("");
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <p className="mt-1 w-[calc(100cqw-4rem)] max-w-full text-[11px] text-muted-foreground">
            {canFilterModels
              ? "Filters apply to these threads. Shares are within this selection; project and chart totals stay unchanged."
              : "Update this project's environment to filter threads by model."}
          </p>
        </td>
      </tr>
      {isPending ? (
        <tr>
          <td
            colSpan={columnCount}
            className="py-4 pl-10 text-xs text-muted-foreground"
            role="status"
          >
            Loading threads…
          </td>
        </tr>
      ) : (
        <>
          <tr className="border-b border-border/50 bg-muted/20 text-[11px] text-muted-foreground">
            <td />
            <SortableHeader column="name" label="Thread" align="left" sort={sort} onSort={onSort} />
            {columns.map((column) => (
              <SortableHeader
                key={column}
                column={column}
                label={USAGE_COLUMNS.find((entry) => entry.key === column)!.label}
                sort={sort}
                onSort={onSort}
                className="px-2"
              />
            ))}
          </tr>
          {sorted.map(({ row, totalTokens, share }) => {
            const key = `${row.environmentId}\u0000${row.key}`;
            return (
              <ThreadRowGroup
                key={key}
                row={row}
                tokens={totalTokens}
                share={share}
                columns={columns}
                open={openRows.has(key)}
                sinceDay={input.sinceDay}
                untilDay={input.untilDay}
                onToggle={() =>
                  setOpenRows((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              />
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="py-4 pl-10 text-xs text-muted-foreground">
                {unavailable
                  ? "Thread activity could not be loaded."
                  : "No threads match these filters in this window."}
              </td>
            </tr>
          ) : null}
          {filtered && rows.length > 0 ? (
            <tr className="border-b border-border text-xs text-muted-foreground">
              <td />
              <td className="py-2">Filtered threads</td>
              <UsageMetricCells row={filteredTotal} columns={columns} />
            </tr>
          ) : null}
          {truncatedRows > 0 || unavailable > 0 ? (
            <tr>
              <td
                colSpan={columnCount}
                className="py-2 pl-10 text-xs text-muted-foreground"
                role="status"
              >
                {truncatedRows > 0
                  ? `${truncatedRows} lower-cost threads included in Other threads. `
                  : ""}
                {unavailable > 0
                  ? `${unavailable} environments could not report complete thread activity.`
                  : ""}
              </td>
            </tr>
          ) : null}
        </>
      )}
    </>
  );
}
