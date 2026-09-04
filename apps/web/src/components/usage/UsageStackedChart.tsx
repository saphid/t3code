import type { UsageTimelineCell } from "@t3tools/shared/usageMerge";
import { useMemo, useState } from "react";

import { formatDateTimeShort, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { cn } from "../../lib/utils";

const WIDTH = 960;
const HEIGHT = 280;
const TOP = 12;
const BOTTOM = 24;

export type UsageGrouping = "30m" | "1h" | "6h" | "12h" | "1d";
export type UsageSeriesMode = "projects" | "providers";
export type UsageStackMetric = "cost" | "tokens";

export interface UsageChartSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

export const GROUP_MS: Record<UsageGrouping, number> = {
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function projectSeriesKey(projectKey: string | null | undefined): string {
  return projectKey === null
    ? "outside"
    : projectKey === undefined
      ? "unknown"
      : `project:${projectKey}`;
}

interface GroupedPoint {
  readonly startMs: number;
  readonly values: ReadonlyMap<string, number>;
  readonly models: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export function groupTimeline(
  cells: readonly UsageTimelineCell[],
  seriesMode: UsageSeriesMode,
  metric: UsageStackMetric,
  grouping: UsageGrouping,
  sinceTime: string,
  untilTime: string,
  visibleModels: ReadonlySet<string>,
): readonly GroupedPoint[] {
  const sinceMs = Date.parse(sinceTime);
  const untilMs = Date.parse(untilTime);
  const groupMs = GROUP_MS[grouping];
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) return [];
  const count = Math.ceil((untilMs - sinceMs) / groupMs);
  const mutable = Array.from({ length: count }, (_, index) => ({
    startMs: sinceMs + index * groupMs,
    values: new Map<string, number>(),
    models: new Map<string, Map<string, number>>(),
  }));
  for (const cell of cells) {
    if (!visibleModels.has(`${cell.provider}\u0000${cell.model}`)) continue;
    const timeMs = Date.parse(cell.periodStart);
    const index = Math.floor((timeMs - sinceMs) / groupMs);
    const point = mutable[index];
    if (point === undefined) continue;
    const seriesKey =
      seriesMode === "providers" ? cell.provider : projectSeriesKey(cell.projectKey);
    const value = metric === "cost" ? cell.costUsd : cell.totalTokens;
    point.values.set(seriesKey, (point.values.get(seriesKey) ?? 0) + value);
    const models = point.models.get(seriesKey) ?? new Map<string, number>();
    models.set(cell.model, (models.get(cell.model) ?? 0) + value);
    point.models.set(seriesKey, models);
  }
  return mutable;
}

function areaPath(
  points: readonly GroupedPoint[],
  series: readonly UsageChartSeries[],
  seriesIndex: number,
  peak: number,
): string {
  if (points.length === 0 || peak <= 0) return "";
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const x = (index: number) =>
    points.length === 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH;
  const valueBefore = (point: GroupedPoint) =>
    series
      .slice(0, seriesIndex)
      .reduce((sum, entry) => sum + (point.values.get(entry.key) ?? 0), 0);
  const valueThrough = (point: GroupedPoint) =>
    valueBefore(point) + (point.values.get(series[seriesIndex]?.key ?? "") ?? 0);
  const y = (value: number) => TOP + plotHeight * (1 - value / peak);
  const top = points.map(
    (point, index) => `${x(index).toFixed(2)},${y(valueThrough(point)).toFixed(2)}`,
  );
  const bottom = points
    .map((point, index) => `${x(index).toFixed(2)},${y(valueBefore(point)).toFixed(2)}`)
    .toReversed();
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

export function UsageStackedChart({
  cells,
  series,
  visibleSeries,
  visibleModels,
  seriesMode,
  metric,
  grouping,
  sinceTime,
  untilTime,
  timeZone,
  activeSeries,
  onActiveSeriesChange,
  onToggleSeries,
  onSelectAll,
  onDeselectAll,
}: {
  readonly cells: readonly UsageTimelineCell[];
  readonly series: readonly UsageChartSeries[];
  readonly visibleSeries: ReadonlySet<string>;
  readonly visibleModels: ReadonlySet<string>;
  readonly seriesMode: UsageSeriesMode;
  readonly metric: UsageStackMetric;
  readonly grouping: UsageGrouping;
  readonly sinceTime: string;
  readonly untilTime: string;
  readonly timeZone: string;
  readonly activeSeries: string | null;
  readonly onActiveSeriesChange: (series: string | null) => void;
  readonly onToggleSeries: (series: string) => void;
  readonly onSelectAll: () => void;
  readonly onDeselectAll: () => void;
}) {
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const shownSeries = series.filter((entry) => visibleSeries.has(entry.key));
  const points = useMemo(
    () => groupTimeline(cells, seriesMode, metric, grouping, sinceTime, untilTime, visibleModels),
    [cells, grouping, metric, seriesMode, sinceTime, untilTime, visibleModels],
  );
  const peak = Math.max(
    0,
    ...points.map((point) =>
      shownSeries.reduce((sum, entry) => sum + (point.values.get(entry.key) ?? 0), 0),
    ),
  );
  const hoveredPoint =
    hoverMs === null || points.length === 0
      ? null
      : (points[
          Math.min(
            points.length - 1,
            Math.max(0, Math.floor((hoverMs - Date.parse(sinceTime)) / GROUP_MS[grouping])),
          )
        ] ?? null);
  const active = series.find((entry) => entry.key === activeSeries) ?? null;
  const activeValue =
    active === null || hoveredPoint === null ? 0 : (hoveredPoint.values.get(active.key) ?? 0);
  const modelRows =
    active === null || hoveredPoint === null
      ? []
      : [...(hoveredPoint.models.get(active.key) ?? new Map()).entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 4);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative min-w-0 overflow-hidden border border-border bg-card/30">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-[280px] w-full touch-pan-y"
          role="img"
          aria-label={`Stacked ${metric} by ${seriesMode}`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
            const raw =
              Date.parse(sinceTime) + fraction * (Date.parse(untilTime) - Date.parse(sinceTime));
            setHoverMs(Math.floor(raw / (30 * 60_000)) * (30 * 60_000));
          }}
          onPointerLeave={() => {
            setHoverMs(null);
            onActiveSeriesChange(null);
          }}
        >
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={WIDTH}
              y1={TOP + (HEIGHT - TOP - BOTTOM) * fraction}
              y2={TOP + (HEIGHT - TOP - BOTTOM) * fraction}
              stroke="currentColor"
              className="text-border"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {shownSeries.map((entry, index) => (
            <path
              key={entry.key}
              d={areaPath(points, shownSeries, index, peak)}
              fill={entry.color}
              fillOpacity={activeSeries === null || activeSeries === entry.key ? 0.78 : 0.12}
              stroke={entry.color}
              strokeWidth={activeSeries === entry.key ? 2 : 1}
              vectorEffect="non-scaling-stroke"
              onPointerEnter={() => onActiveSeriesChange(entry.key)}
              className="transition-opacity"
            />
          ))}
          {hoverMs === null ? null : (
            <line
              x1={
                ((hoverMs - Date.parse(sinceTime)) /
                  (Date.parse(untilTime) - Date.parse(sinceTime))) *
                WIDTH
              }
              x2={
                ((hoverMs - Date.parse(sinceTime)) /
                  (Date.parse(untilTime) - Date.parse(sinceTime))) *
                WIDTH
              }
              y1={TOP}
              y2={HEIGHT - BOTTOM}
              stroke="currentColor"
              className="text-foreground/50"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </svg>
        {active === null || hoveredPoint === null ? null : (
          <div className="pointer-events-none absolute right-2 top-2 min-w-44 border border-border bg-popover/95 px-2.5 py-2 text-xs shadow-sm">
            <div className="text-muted-foreground">
              {formatDateTimeShort(new Date(hoverMs!).toISOString(), timeZone)} · {grouping} total
            </div>
            <div className="mt-1 flex items-center justify-between gap-4 font-medium text-foreground">
              <span className="truncate">{active.label}</span>
              <span className="tabular-nums">
                {metric === "cost" ? formatUsd(activeValue) : formatTokens(activeValue)}
              </span>
            </div>
            {modelRows.map(([model, value]) => (
              <div key={model} className="mt-0.5 flex justify-between gap-4 text-muted-foreground">
                <span className="max-w-36 truncate">{model}</span>
                <span className="tabular-nums">
                  {metric === "cost" ? formatUsd(value) : formatTokens(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatDateTimeShort(sinceTime, timeZone)}</span>
        <span>{formatDateTimeShort(untilTime, timeZone)}</span>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
        aria-label={`${seriesMode} visibility`}
      >
        {series.map((entry) => {
          const visible = visibleSeries.has(entry.key);
          const highlighted = activeSeries === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              aria-pressed={visible}
              onClick={() => onToggleSeries(entry.key)}
              onPointerEnter={() => onActiveSeriesChange(entry.key)}
              onPointerLeave={() => onActiveSeriesChange(null)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs transition-opacity",
                visible ? "text-foreground" : "text-muted-foreground opacity-40 line-through",
                highlighted && "bg-muted font-medium ring-1 ring-border",
                activeSeries !== null && !highlighted && "opacity-25",
              )}
            >
              <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: entry.color }} />
              {entry.label}
            </button>
          );
        })}
        <span className="ms-auto flex gap-2">
          <button type="button" onClick={onSelectAll} className="hover:text-foreground">
            Select all
          </button>
          <button type="button" onClick={onDeselectAll} className="hover:text-foreground">
            Deselect all
          </button>
        </span>
      </div>
    </div>
  );
}
