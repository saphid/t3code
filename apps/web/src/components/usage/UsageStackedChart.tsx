import type { UsageTimelineCell } from "@t3tools/shared/usageMerge";
import { useMemo, useState } from "react";

import { formatDateTimeShort, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";

const WIDTH = 960;
const HEIGHT = 280;
const TOP = 12;
const BOTTOM = 24;
const SOURCE_MS = {
  halfHour: 30 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
} as const;

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

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The source sample beneath the pointer, with its centered chart position. */
export function hoverSampleAt(
  clientX: number,
  plotLeft: number,
  plotWidth: number,
  sinceMs: number,
  untilMs: number,
  sampleMs: number,
): { readonly startMs: number; readonly x: number } | null {
  if (plotWidth <= 0 || untilMs <= sinceMs || sampleMs <= 0) return null;
  const sampleCount = Math.ceil((untilMs - sinceMs) / sampleMs);
  if (sampleCount <= 0) return null;
  const localX = Math.min(plotWidth, Math.max(0, clientX - plotLeft));
  const index = Math.min(sampleCount - 1, Math.floor((localX / plotWidth) * sampleCount));
  return {
    startMs: sinceMs + index * sampleMs,
    x: ((index + 0.5) / sampleCount) * WIDTH,
  };
}

/** The visual aggregate containing a source sample. */
export function groupedPointIndexAt(
  sampleStartMs: number,
  sinceMs: number,
  grouping: UsageGrouping,
  pointCount: number,
): number | null {
  if (pointCount <= 0 || sampleStartMs < sinceMs) return null;
  const index = Math.floor((sampleStartMs - sinceMs) / GROUP_MS[grouping]);
  return index < pointCount ? index : null;
}

function sampleCenterX(
  startMs: number,
  sinceMs: number,
  untilMs: number,
  sampleMs: number,
): number | null {
  if (untilMs <= sinceMs || sampleMs <= 0) return null;
  const sampleCount = Math.ceil((untilMs - sinceMs) / sampleMs);
  const index = Math.floor((startMs - sinceMs) / sampleMs);
  if (index < 0 || index >= sampleCount) return null;
  return ((index + 0.5) / sampleCount) * WIDTH;
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

/** Shape-preserving cubic tangents that cannot overshoot usage peaks. */
function monotoneTangents(points: readonly Point[]): readonly number[] {
  if (points.length < 2) return [0];
  const slopes = points.slice(1).map((point, index) => {
    const previous = points[index]!;
    const dx = point.x - previous.x;
    return dx === 0 ? 0 : (point.y - previous.y) / dx;
  });
  const tangents = Array.from({ length: points.length }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[tangents.length - 1] = slopes[slopes.length - 1] ?? 0;
  for (let index = 1; index < tangents.length - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = (tangents[index] ?? 0) / slope;
    const b = (tangents[index + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }
  return tangents;
}

function curvePath(points: readonly Point[]): string {
  if (points.length < 2) return "";
  const tangents = monotoneTangents(points);
  let path = `M${points[0]!.x.toFixed(2)},${points[0]!.y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const dx = to.x - from.x;
    path += ` C${(from.x + dx / 3).toFixed(2)},${(from.y + ((tangents[index] ?? 0) * dx) / 3).toFixed(2)} ${(to.x - dx / 3).toFixed(2)},${(to.y - ((tangents[index + 1] ?? 0) * dx) / 3).toFixed(2)} ${to.x.toFixed(2)},${to.y.toFixed(2)}`;
  }
  return path;
}

export function stackedAreaPath(
  points: readonly GroupedPoint[],
  series: readonly UsageChartSeries[],
  seriesIndex: number,
  peak: number,
): string {
  if (points.length === 0 || peak <= 0) return "";
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const step = WIDTH / points.length;
  const x = (index: number) => (index + 0.5) * step;
  const valueBefore = (point: GroupedPoint) =>
    series
      .slice(0, seriesIndex)
      .reduce((sum, entry) => sum + (point.values.get(entry.key) ?? 0), 0);
  const valueThrough = (point: GroupedPoint) =>
    valueBefore(point) + (point.values.get(series[seriesIndex]?.key ?? "") ?? 0);
  const y = (value: number) => TOP + plotHeight * (1 - value / peak);
  const paddedPoints = (values: readonly number[]) => {
    const centers = values.map((value, index) => ({ x: x(index), y: y(value) }));
    if (centers.length === 0) return [];
    return [
      { x: 0, y: centers[0]!.y },
      ...centers,
      { x: WIDTH, y: centers[centers.length - 1]!.y },
    ];
  };
  const top = paddedPoints(points.map(valueThrough));
  const bottom = paddedPoints(points.map(valueBefore)).toReversed();
  const upper = curvePath(top);
  const lower = curvePath(bottom);
  return upper === "" || lower === "" ? "" : `${upper} ${lower.replace(/^M/, "L")} Z`;
}

export function UsageStackedChart({
  cells,
  series,
  visibleSeries,
  visibleModels,
  seriesMode,
  metric,
  grouping,
  sourceResolution = "day",
  sinceTime,
  untilTime,
  timeZone,
  activeSeries,
  onActiveSeriesChange,
}: {
  readonly cells: readonly UsageTimelineCell[];
  readonly series: readonly UsageChartSeries[];
  readonly visibleSeries: ReadonlySet<string>;
  readonly visibleModels: ReadonlySet<string>;
  readonly seriesMode: UsageSeriesMode;
  readonly metric: UsageStackMetric;
  readonly grouping: UsageGrouping;
  readonly sourceResolution?: keyof typeof SOURCE_MS;
  readonly sinceTime: string;
  readonly untilTime: string;
  readonly timeZone: string;
  readonly activeSeries: string | null;
  readonly onActiveSeriesChange: (series: string | null) => void;
}) {
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const sourceMs = SOURCE_MS[sourceResolution];
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
          groupedPointIndexAt(hoverMs, Date.parse(sinceTime), grouping, points.length) ?? -1
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
            const sample = hoverSampleAt(
              event.clientX,
              bounds.left,
              bounds.width,
              Date.parse(sinceTime),
              Date.parse(untilTime),
              sourceMs,
            );
            if (sample !== null) setHoverMs(sample.startMs);
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
              d={stackedAreaPath(points, shownSeries, index, peak)}
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
                sampleCenterX(hoverMs, Date.parse(sinceTime), Date.parse(untilTime), sourceMs) ?? 0
              }
              x2={
                sampleCenterX(hoverMs, Date.parse(sinceTime), Date.parse(untilTime), sourceMs) ?? 0
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
    </div>
  );
}
