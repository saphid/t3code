import type { UsageTimelineCell } from "@t3tools/shared/usageMerge";
import { useMemo, useRef, useState } from "react";

import {
  formatDateTimeShort,
  formatDayShort,
  formatTokens,
  formatUsd,
} from "@t3tools/shared/usageFormat";

import { cn } from "../../lib/utils";
import { niceScale } from "./UsageProviderChart";
import { chartSelection } from "./usageChartSelection";

const WIDTH = 960;
const HEIGHT = 280;
const TOP = 12;
const BOTTOM = 24;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const SOURCE_MS = {
  halfHour: 30 * 60_000,
  hour: HOUR_MS,
  day: DAY_MS,
} as const;

export type UsageGrouping = "30m" | "1h" | "6h" | "12h" | "1d";
export type UsageSeriesMode = "projects" | "providers" | "models";
export type UsageStackMetric = "cost" | "tokens";

export interface UsageChartSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

export const GROUP_MS: Record<UsageGrouping, number> = {
  "30m": 30 * 60_000,
  "1h": HOUR_MS,
  "6h": 6 * HOUR_MS,
  "12h": 12 * HOUR_MS,
  "1d": DAY_MS,
};

export function projectSeriesKey(projectKey: string | null | undefined): string {
  return projectKey === null
    ? "outside"
    : projectKey === undefined
      ? "unknown"
      : `project:${projectKey}`;
}

/** Same key the page uses for model visibility, so hiding a model hides its series. */
export function modelSeriesKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

/**
 * Visual grouping that lands a window on roughly 24 to 90 points: hourly for a
 * day, six-hourly up to ten days, daily beyond that.
 */
export function autoGrouping(sinceTime: string, untilTime: string): UsageGrouping {
  const spanMs = Date.parse(untilTime) - Date.parse(sinceTime);
  if (!Number.isFinite(spanMs) || spanMs <= 0) return "1d";
  if (spanMs <= DAY_MS + HOUR_MS) return "1h";
  if (spanMs <= 10 * DAY_MS) return "6h";
  return "1d";
}

export interface TimeTick {
  readonly ms: number;
  readonly label: string;
}

/**
 * Axis ticks for a window: six-hour marks within two days, otherwise local
 * midnights thinned to at most eight labels. Midnights are found by walking
 * hourly and watching the zoned calendar day change, which stays right across
 * DST without any offset arithmetic.
 */
export function timeTicks(
  sinceTime: string,
  untilTime: string,
  timeZone: string,
): readonly TimeTick[] {
  const sinceMs = Date.parse(sinceTime);
  const untilMs = Date.parse(untilTime);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) return [];
  if (untilMs - sinceMs <= 2 * DAY_MS) {
    const ticks: TimeTick[] = [];
    for (let ms = sinceMs + 6 * HOUR_MS; ms < untilMs; ms += 6 * HOUR_MS) {
      ticks.push({ ms, label: formatDateTimeShort(new Date(ms).toISOString(), timeZone) });
    }
    return ticks;
  }
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const midnights: TimeTick[] = [];
  let previousDay = format.format(new Date(sinceMs));
  for (let ms = sinceMs + HOUR_MS; ms < untilMs; ms += HOUR_MS) {
    const day = format.format(new Date(ms));
    if (day === previousDay) continue;
    previousDay = day;
    midnights.push({ ms, label: formatDayShort(day) });
  }
  const every = Math.max(1, Math.ceil(midnights.length / 8));
  return midnights.filter((_, index) => index % every === 0);
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
  visibleModels?: ReadonlySet<string>,
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
    const modelKey = modelSeriesKey(cell.provider, cell.model);
    if (visibleModels !== undefined && !visibleModels.has(modelKey)) continue;
    const timeMs = Date.parse(cell.periodStart);
    const index = Math.floor((timeMs - sinceMs) / groupMs);
    const point = mutable[index];
    if (point === undefined) continue;
    const seriesKey =
      seriesMode === "providers"
        ? cell.provider
        : seriesMode === "models"
          ? modelKey
          : projectSeriesKey(cell.projectKey);
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

/**
 * Stacked area of the window by the chosen series. Static SVG with HTML axis
 * labels so text stays crisp at any width; the only motion is the hover cursor.
 */
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
  onSelectRange,
  onResetRange,
}: {
  readonly cells: readonly UsageTimelineCell[];
  readonly series: readonly UsageChartSeries[];
  readonly visibleSeries: ReadonlySet<string>;
  /** Restricts cells to these model keys; omit to chart every model. */
  readonly visibleModels?: ReadonlySet<string>;
  readonly seriesMode: UsageSeriesMode;
  readonly metric: UsageStackMetric;
  readonly grouping: UsageGrouping;
  readonly sourceResolution?: keyof typeof SOURCE_MS;
  readonly sinceTime: string;
  readonly untilTime: string;
  readonly timeZone: string;
  readonly activeSeries: string | null;
  readonly onActiveSeriesChange: (series: string | null) => void;
  readonly onSelectRange?: (range: { sinceTime: string; untilTime: string }) => void;
  readonly onResetRange?: () => void;
}) {
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const dragStart = useRef<{ pointerId: number; x: number; width: number; left: number } | null>(
    null,
  );
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const cancelSelection = () => {
    dragStart.current = null;
    setSelection(null);
  };
  const sourceMs = SOURCE_MS[sourceResolution];
  const sinceMs = Date.parse(sinceTime);
  const untilMs = Date.parse(untilTime);
  const spanMs = untilMs - sinceMs;
  const shownSeries = useMemo(
    () => series.filter((entry) => visibleSeries.has(entry.key)),
    [series, visibleSeries],
  );
  const points = useMemo(
    () => groupTimeline(cells, seriesMode, metric, grouping, sinceTime, untilTime, visibleModels),
    [cells, grouping, metric, seriesMode, sinceTime, untilTime, visibleModels],
  );
  const peak = useMemo(
    () =>
      Math.max(
        0,
        ...points.map((point) =>
          shownSeries.reduce((sum, entry) => sum + (point.values.get(entry.key) ?? 0), 0),
        ),
      ),
    [points, shownSeries],
  );
  const scale = useMemo(() => niceScale(peak, 4), [peak]);
  const plotMax = scale.max > 0 ? scale.max : 1;
  const ticks = useMemo(
    () => timeTicks(sinceTime, untilTime, timeZone),
    [sinceTime, timeZone, untilTime],
  );
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const yFor = (value: number) => TOP + plotHeight * (1 - value / plotMax);
  const xFor = (ms: number) => (spanMs <= 0 ? 0 : ((ms - sinceMs) / spanMs) * WIDTH);
  const format = (value: number) => (metric === "cost" ? formatUsd(value) : formatTokens(value));

  const hoveredPoint =
    hoverMs === null || points.length === 0
      ? null
      : (points[groupedPointIndexAt(hoverMs, sinceMs, grouping, points.length) ?? -1] ?? null);
  const hoverX = hoverMs === null ? null : sampleCenterX(hoverMs, sinceMs, untilMs, sourceMs);
  const hoveredRows = useMemo(() => {
    if (hoveredPoint === null) return [];
    return shownSeries
      .map((entry) => ({ entry, value: hoveredPoint.values.get(entry.key) ?? 0 }))
      .filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value);
  }, [hoveredPoint, shownSeries]);
  const hoveredTotal = hoveredRows.reduce((sum, row) => sum + row.value, 0);
  const active = series.find((entry) => entry.key === activeSeries) ?? null;
  const tooltipRows =
    active === null
      ? hoveredRows.slice(0, 6)
      : [
          ...hoveredRows.filter((row) => row.entry.key === active.key),
          ...hoveredRows.filter((row) => row.entry.key !== active.key).slice(0, 5),
        ];
  const moreRows = hoveredRows.length - tooltipRows.length;
  const activeModels =
    active === null || hoveredPoint === null || seriesMode === "models"
      ? []
      : [...(hoveredPoint.models.get(active.key) ?? new Map<string, number>()).entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 3);
  const hoverPercent = hoverX === null ? null : (hoverX / WIDTH) * 100;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative min-w-0 rounded-md border border-border bg-card/30">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className={cn(
            "block h-60 w-full touch-pan-y outline-none",
            onSelectRange && "cursor-crosshair select-none",
            !selection && "focus-visible:ring-2 focus-visible:ring-ring",
          )}
          role="img"
          aria-label={`Stacked ${metric} by ${seriesMode}${onSelectRange ? ". Drag to select a time range. Escape cancels; double-click resets." : ""}`}
          tabIndex={onSelectRange ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelSelection();
          }}
          onDoubleClick={onResetRange}
          onPointerDown={(event) => {
            if (!onSelectRange || event.button !== 0 || !event.isPrimary) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            dragStart.current = {
              pointerId: event.pointerId,
              x: event.clientX - bounds.left,
              left: bounds.left,
              width: bounds.width,
            };
            setSelection({
              start: ((event.clientX - bounds.left) / bounds.width) * WIDTH,
              end: ((event.clientX - bounds.left) / bounds.width) * WIDTH,
            });
            setHoverMs(null);
            onActiveSeriesChange(null);
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const drag = dragStart.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const range = chartSelection(
              drag.x,
              event.clientX - drag.left,
              drag.width,
              sinceMs,
              untilMs,
              sourceMs,
            );
            cancelSelection();
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            if (range) onSelectRange?.(range);
          }}
          onPointerCancel={cancelSelection}
          onLostPointerCapture={cancelSelection}
          onPointerMove={(event) => {
            const drag = dragStart.current;
            if (drag) {
              if (drag.pointerId === event.pointerId)
                setSelection({
                  start: (drag.x / drag.width) * WIDTH,
                  end: Math.min(
                    WIDTH,
                    Math.max(0, ((event.clientX - drag.left) / drag.width) * WIDTH),
                  ),
                });
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            const sample = hoverSampleAt(
              event.clientX,
              bounds.left,
              bounds.width,
              sinceMs,
              untilMs,
              sourceMs,
            );
            if (sample !== null) setHoverMs(sample.startMs);
            if (event.target === event.currentTarget && activeSeries !== null) {
              onActiveSeriesChange(null);
            }
          }}
          onPointerLeave={() => {
            setHoverMs(null);
            onActiveSeriesChange(null);
          }}
        >
          {scale.ticks.map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={WIDTH}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke="currentColor"
              className={tick === 0 ? "text-border" : "text-border/60"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {ticks.map((tick) => (
            <line
              key={tick.ms}
              x1={xFor(tick.ms)}
              x2={xFor(tick.ms)}
              y1={TOP}
              y2={HEIGHT - BOTTOM}
              stroke="currentColor"
              strokeDasharray="2 4"
              className="text-border/50"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {shownSeries.map((entry, index) => (
            <path
              key={entry.key}
              d={stackedAreaPath(points, shownSeries, index, plotMax)}
              fill={entry.color}
              fillOpacity={activeSeries === null || activeSeries === entry.key ? 0.78 : 0.14}
              stroke={entry.color}
              strokeWidth={activeSeries === entry.key ? 2 : 1}
              vectorEffect="non-scaling-stroke"
              onPointerEnter={() => {
                if (!dragStart.current) onActiveSeriesChange(entry.key);
              }}
              className="transition-opacity"
            />
          ))}
          {selection ? (
            <rect
              x={Math.min(selection.start, selection.end)}
              y={TOP}
              width={Math.abs(selection.end - selection.start)}
              height={plotHeight}
              className="fill-primary/20 stroke-primary"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
          {hoverX === null ? null : (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={TOP}
              y2={HEIGHT - BOTTOM}
              stroke="currentColor"
              className="text-foreground/50"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </svg>
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {scale.ticks
            .filter((tick) => tick > 0)
            .map((tick) => (
              <span
                key={tick}
                className="absolute left-1.5 mt-0.5 rounded-sm bg-background/70 px-1 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: `${(yFor(tick) / HEIGHT) * 100}%` }}
              >
                {format(tick)}
              </span>
            ))}
        </div>
        {peak === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {visibleSeries.size === 0 && series.length > 0
              ? "All series hidden. Select rows in the breakdown to show usage."
              : "No usage in this window"}
          </div>
        ) : null}
        {hoveredPoint === null || hoverPercent === null ? null : (
          <div
            className="pointer-events-none absolute top-2 w-56 max-w-[calc(100%-1rem)] rounded-md border border-border bg-popover/95 px-2.5 py-2 text-xs shadow-sm"
            style={{
              left: `clamp(8px, calc(${hoverPercent}% + 12px), max(8px, calc(100% - 14rem - 8px)))`,
            }}
          >
            <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
              <span>
                {formatDateTimeShort(new Date(hoveredPoint.startMs).toISOString(), timeZone)}
              </span>
              <span>{grouping}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 font-medium text-foreground">
              <span>Total</span>
              <span className="tabular-nums">{format(hoveredTotal)}</span>
            </div>
            {tooltipRows.map((row) => (
              <div
                key={row.entry.key}
                className={cn(
                  "mt-0.5 flex items-center justify-between gap-3",
                  row.entry.key === activeSeries ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: row.entry.color }}
                  />
                  <span className="truncate">{row.entry.label}</span>
                </span>
                <span className="shrink-0 tabular-nums">{format(row.value)}</span>
              </div>
            ))}
            {activeModels.map(([model, value]) => (
              <div
                key={model}
                className="mt-0.5 flex justify-between gap-3 ps-3.5 text-muted-foreground/80"
              >
                <span className="truncate">{model}</span>
                <span className="shrink-0 tabular-nums">{format(value)}</span>
              </div>
            ))}
            {moreRows > 0 ? (
              <div className="mt-0.5 text-muted-foreground/70">{moreRows} more</div>
            ) : null}
          </div>
        )}
      </div>
      <div aria-hidden className="relative h-4 text-[10px] text-muted-foreground">
        {ticks.map((tick) => (
          <span
            key={tick.ms}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${spanMs <= 0 ? 0 : ((tick.ms - sinceMs) / spanMs) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
