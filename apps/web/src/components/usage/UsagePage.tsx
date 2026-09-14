import type { UsageProviderKind } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import type { ProjectTotals } from "@t3tools/shared/usageMerge";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useUsage } from "../../state/usage";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { UsageBreakdownTable, type BreakdownTableRow } from "./UsageBreakdownTable";
import { UsageLimitsSection } from "./UsageLimits";
import { UsagePriceOverrides } from "./UsagePriceOverrides";
import { UsageProjectThreads } from "./UsageProjectThreads";
import { UsageColumns } from "./UsageColumns";
import { selectedUsageWindow } from "./usageChartSelection";
import { usageTokenColumns } from "./usageTokenColumns";
import { evaluateDailyUsageBudget } from "./usageBudget";
import {
  defaultBreakdownSort,
  toggleBreakdownSort,
  type BreakdownColumn,
} from "./usageBreakdownSort";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsageDimension,
  type UsagePagePreferences,
} from "./usagePagePreferences";
import { PROVIDER_PRESENTATION, providersWithUsage } from "./usageProviders";
import {
  autoGrouping,
  modelSeriesKey,
  projectSeriesKey,
  UsageStackedChart,
  type UsageChartSeries,
  type UsageGrouping,
  type UsageSeriesMode,
} from "./UsageStackedChart";

type WindowPreset = UsagePagePreferences["windowDays"] | "custom" | "selection";

const WINDOW_OPTIONS: readonly { days: UsagePagePreferences["windowDays"]; label: string }[] = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];
const DIMENSION_OPTIONS: readonly { value: UsageDimension; label: string }[] = [
  { value: "projects", label: "Projects" },
  { value: "providers", label: "Providers" },
  { value: "models", label: "Models" },
];
const GROUPING_OPTIONS: readonly { value: UsagePagePreferences["grouping"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "12h", label: "12 hours" },
  { value: "1d", label: "1 day" },
];
/** Categorical series colors spaced for dark and light backgrounds. */
const SERIES_COLORS = [
  "#5b8def",
  "#e0a52c",
  "#3fae8c",
  "#c65fa2",
  "#8d78e6",
  "#e26f4c",
  "#7fb241",
  "#d9c34a",
  "#4aa8c9",
  "#b8865b",
  "#8f9bb3",
  "#c94f6f",
] as const;
const UNKNOWN_COLOR = "#777777";
const MAX_CUSTOM_MS = 90 * 24 * 60 * 60_000;

function exactWindow(days: number) {
  return makeWindow(days, undefined, "halfHour");
}

function localDayBoundary(day: string, nextDay: boolean): string | null {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  const value = new Date(year, month - 1, date + (nextDay ? 1 : 0));
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function projectLabel(project: Pick<ProjectTotals, "projectKey" | "project">): string {
  if (project.projectKey === null) return "Outside T3 projects";
  return project.project ?? "Unknown attribution";
}

function setToggled<T extends string>(current: ReadonlySet<T>, key: T): ReadonlySet<T> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

export function UsagePage() {
  const [view, setView] = useState<"usage" | "limits">("usage");
  const [preferences, setPreferences] = useState(readUsagePagePreferences);
  const updatePreferences = (patch: Partial<UsagePagePreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      saveUsagePagePreferences(next);
      return next;
    });
  };
  const { metric, dimension } = preferences;
  const [windowSelection, setWindowSelection] = useState<{
    preset: WindowPreset;
    window: ReturnType<typeof exactWindow>;
  }>(() => ({ preset: preferences.windowDays, window: exactWindow(preferences.windowDays) }));
  const [zoomBase, setZoomBase] = useState<typeof windowSelection | null>(null);
  const [hiddenProjects, setHiddenProjects] = useState<ReadonlySet<string>>(new Set());
  const [hiddenProviders, setHiddenProviders] = useState<ReadonlySet<string>>(new Set());
  const [hiddenModels, setHiddenModels] = useState<ReadonlySet<string>>(new Set());
  const [activeSeries, setActiveSeries] = useState<string | null>(null);
  const [modelPricesOpen, setModelPricesOpen] = useState(false);

  const { preset, window } = windowSelection;
  const { merged, environments, isPending, isPartial, isRefreshing, refreshError, refresh } =
    useUsage(window);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const settling = isPending && merged.availableThroughDay === null;
  const untilTime = merged.availableThroughTime ?? window.untilTime!;
  const grouping: UsageGrouping =
    preferences.grouping === "auto"
      ? autoGrouping(window.sinceTime!, untilTime)
      : preferences.grouping;
  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);

  // Sessions that carried no trusted working directory live only in the
  // timeline, so the projects table derives their row from the cells.
  const unknownTotals = useMemo(() => {
    let costUsd = 0;
    let totalTokens = 0;
    let cacheWriteTokens = 0;
    for (const cell of merged.timeline) {
      if (cell.projectKey !== undefined) continue;
      costUsd += cell.costUsd;
      totalTokens += cell.totalTokens;
      cacheWriteTokens += cell.totals?.cacheCreationTokens ?? 0;
    }
    return costUsd > 0 || totalTokens > 0 ? { costUsd, totalTokens, cacheWriteTokens } : null;
  }, [merged.timeline]);

  const projectSeries = useMemo<readonly UsageChartSeries[]>(() => {
    const values: UsageChartSeries[] = merged.projects.map((project, index) => ({
      key: projectSeriesKey(project.projectKey),
      label: projectLabel(project),
      color: SERIES_COLORS[index % SERIES_COLORS.length]!,
    }));
    if (unknownTotals !== null) {
      values.push({ key: "unknown", label: "Unknown attribution", color: UNKNOWN_COLOR });
    }
    return values;
  }, [merged.projects, unknownTotals]);
  const providerSeries = useMemo<readonly UsageChartSeries[]>(
    () =>
      activeProviders.map((provider) => ({
        key: provider,
        label: PROVIDER_PRESENTATION[provider].label,
        color: PROVIDER_PRESENTATION[provider].color,
      })),
    [activeProviders],
  );
  const modelSeries = useMemo<readonly UsageChartSeries[]>(
    () =>
      merged.models.map((model, index) => ({
        key: modelSeriesKey(model.provider, model.model),
        label: model.model,
        color: SERIES_COLORS[index % SERIES_COLORS.length]!,
      })),
    [merged.models],
  );

  const seriesMode: UsageSeriesMode = dimension;
  const series =
    seriesMode === "projects"
      ? projectSeries
      : seriesMode === "providers"
        ? providerSeries
        : modelSeries;
  const hiddenForSeries =
    seriesMode === "projects"
      ? hiddenProjects
      : seriesMode === "providers"
        ? hiddenProviders
        : hiddenModels;
  const visibleSeries = useMemo(
    () => new Set(series.filter((entry) => !hiddenForSeries.has(entry.key)).map((e) => e.key)),
    [hiddenForSeries, series],
  );
  const chartCells = useMemo(
    () =>
      merged.timeline.filter(
        (cell) =>
          !hiddenForSeries.has(
            seriesMode === "projects"
              ? projectSeriesKey(cell.projectKey)
              : seriesMode === "providers"
                ? cell.provider
                : modelSeriesKey(cell.provider, cell.model),
          ),
      ),
    [hiddenForSeries, seriesMode, merged.timeline],
  );
  const tokenColumns = useMemo(
    () => ({
      projects: usageTokenColumns(merged.timeline, (cell) => projectSeriesKey(cell.projectKey)),
      providers: usageTokenColumns(merged.timeline, (cell) => cell.provider),
      models: usageTokenColumns(merged.timeline, (cell) =>
        modelSeriesKey(cell.provider, cell.model),
      ),
    }),
    [merged.timeline],
  );
  const modelsByProject = useMemo(() => {
    const byProject = new Map<
      string,
      Map<string, { provider: UsageProviderKind; model: string }>
    >();
    for (const cell of merged.timeline) {
      const key = projectSeriesKey(cell.projectKey);
      const models =
        byProject.get(key) ?? new Map<string, { provider: UsageProviderKind; model: string }>();
      models.set(modelSeriesKey(cell.provider, cell.model), {
        provider: cell.provider,
        model: cell.model,
      });
      byProject.set(key, models);
    }
    return new Map(
      [...byProject].map(([key, models]) => [
        key,
        [...models.values()].sort(
          (a, b) => a.model.localeCompare(b.model) || a.provider.localeCompare(b.provider),
        ),
      ]),
    );
  }, [merged.timeline]);

  const colorByKey = useMemo(
    () =>
      new Map([...projectSeries, ...providerSeries, ...modelSeries].map((e) => [e.key, e.color])),
    [modelSeries, projectSeries, providerSeries],
  );
  const projectRows = useMemo<readonly BreakdownTableRow[]>(() => {
    const rows: BreakdownTableRow[] = merged.projects.map((project) => {
      const key = projectSeriesKey(project.projectKey);
      return {
        key,
        label: projectLabel(project),
        color: colorByKey.get(key) ?? UNKNOWN_COLOR,
        ...tokenColumns.projects.get(key),
        costUsd: project.costUsd,
        totalTokens: project.totalTokens,
        share:
          metric === "cost" ? project.costShare : ratio(project.totalTokens, merged.totalTokens),
        cacheWriteTokens: project.cacheWriteTokens,
        cacheWriteUsd: project.cacheWriteUsd,
        sessions: null,
      };
    });
    if (unknownTotals !== null) {
      rows.push({
        key: "unknown",
        ...tokenColumns.projects.get("unknown"),
        label: "Unknown attribution",
        color: UNKNOWN_COLOR,
        costUsd: unknownTotals.costUsd,
        totalTokens: unknownTotals.totalTokens,
        share:
          metric === "cost"
            ? ratio(unknownTotals.costUsd, merged.costUsd)
            : ratio(unknownTotals.totalTokens, merged.totalTokens),
        cacheWriteTokens: unknownTotals.cacheWriteTokens,
        cacheWriteUsd: unknownTotals.cacheWriteTokens === 0 ? 0 : null,
        sessions: null,
      });
    }
    return rows;
  }, [
    colorByKey,
    merged.costUsd,
    merged.projects,
    merged.totalTokens,
    metric,
    unknownTotals,
    tokenColumns.projects,
  ]);
  const providerRows = useMemo<readonly BreakdownTableRow[]>(
    () =>
      activeProviders.map((provider) => {
        const totals = merged.providers.find((entry) => entry.provider === provider);
        const models = merged.models.filter((model) => model.provider === provider);
        const cacheWriteTokens = models.reduce((sum, model) => sum + model.cacheWriteTokens, 0);
        const cacheWriteUsd = models.some(
          (model) => model.cacheWriteTokens > 0 && model.cacheWriteUsd === null,
        )
          ? null
          : models.reduce((sum, model) => sum + (model.cacheWriteUsd ?? 0), 0);
        return {
          key: provider,
          ...tokenColumns.providers.get(provider),
          label: PROVIDER_PRESENTATION[provider].label,
          color: PROVIDER_PRESENTATION[provider].color,
          costUsd: totals?.costUsd ?? 0,
          totalTokens: totals?.totalTokens ?? 0,
          share: metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0),
          cacheWriteTokens,
          cacheWriteUsd,
          sessions: totals?.sessions ?? 0,
        };
      }),
    [activeProviders, merged.models, merged.providers, metric, tokenColumns.providers],
  );
  const modelRows = useMemo<readonly BreakdownTableRow[]>(
    () =>
      merged.models.map((model) => {
        const key = modelSeriesKey(model.provider, model.model);
        return {
          key,
          ...tokenColumns.models.get(key),
          label: model.model,
          color: colorByKey.get(key) ?? UNKNOWN_COLOR,
          provider: model.provider,
          costUsd: model.costUsd,
          totalTokens: model.totalTokens,
          share: metric === "cost" ? model.costShare : ratio(model.totalTokens, merged.totalTokens),
          cacheWriteTokens: model.cacheWriteTokens,
          cacheWriteUsd: model.cacheWriteUsd,
          sessions: null,
        };
      }),
    [colorByKey, merged.models, merged.totalTokens, metric, tokenColumns.models],
  );

  const sort =
    preferences.sort[dimension] ?? defaultBreakdownSort(metric, preferences.hiddenColumns);
  const onSort = (column: BreakdownColumn) =>
    updatePreferences({
      sort: { ...preferences.sort, [dimension]: toggleBreakdownSort(sort, column) },
    });

  const budgetAlert = useMemo(
    () => evaluateDailyUsageBudget(merged.daily, window.untilDay),
    [merged.daily, window.untilDay],
  );

  const selectPreset = (days: UsagePagePreferences["windowDays"]) => {
    setZoomBase(null);
    setWindowSelection({ preset: days, window: exactWindow(days) });
    updatePreferences({ windowDays: days });
  };
  const setDate = (edge: "from" | "to", value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const nextSince = edge === "from" ? localDayBoundary(value, false) : window.sinceTime!;
    const nextUntil = edge === "to" ? localDayBoundary(value, true) : window.untilTime!;
    if (nextSince === null || nextUntil === null) return;
    if (Date.parse(nextUntil) <= Date.parse(nextSince)) return;
    if (Date.parse(nextUntil) - Date.parse(nextSince) > MAX_CUSTOM_MS) return;
    setZoomBase(null);
    setWindowSelection({
      preset: "custom",
      window: {
        ...window,
        sinceDay: (edge === "from" ? value : window.sinceDay) as typeof window.sinceDay,
        untilDay: (edge === "to" ? value : window.untilDay) as typeof window.untilDay,
        sinceTime: nextSince,
        untilTime: nextUntil,
        resolution: "halfHour",
      },
    });
  };
  const refreshWindow = () => {
    if (view === "limits") {
      if (primaryEnvironmentId)
        void refreshProviders({ environmentId: primaryEnvironmentId, input: {} });
      return;
    }
    if (preset === "custom" || preset === "selection") {
      refresh(window);
      return;
    }
    const nextWindow = exactWindow(preset);
    setWindowSelection({ preset, window: nextWindow });
    refresh(nextWindow);
  };

  const topbar = (
    <div className="flex w-full min-w-0 items-center gap-2">
      <WorkspaceBreadcrumb ariaLabel="Usage breadcrumb" className="min-w-0">
        <WorkspaceBreadcrumbItem current>
          <h1>Usage</h1>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      <ToggleGroup
        aria-label="Usage section"
        variant="segmented"
        value={[view]}
        className="ms-auto"
        onValueChange={(next) => {
          const value = next[0];
          if (value === "usage" || value === "limits") setView(value);
        }}
      >
        <Toggle value="usage">Usage</Toggle>
        <Toggle value="limits">Limits</Toggle>
      </ToggleGroup>
      <Button onClick={() => setModelPricesOpen(true)} size="sm" variant="ghost">
        <SlidersHorizontalIcon aria-hidden className="size-3.5" />
        Model prices
      </Button>
      <Button
        onClick={refreshWindow}
        aria-label={view === "limits" ? "Refresh limits" : "Refresh usage"}
        size="icon-sm"
        variant="ghost"
      >
        <RefreshCwIcon className={cn("size-3.5", isRefreshing && "opacity-50")} />
      </Button>
    </div>
  );

  const threadInput = {
    sinceDay: window.sinceDay,
    untilDay: window.untilDay,
    timeZone: window.timeZone,
    ...(window.sinceTime === undefined ? {} : { sinceTime: window.sinceTime }),
    ...(window.untilTime === undefined ? {} : { untilTime: window.untilTime }),
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader electron={isElectron}>{topbar}</WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide" className="gap-5">
            {view === "limits" ? (
              <UsageLimitsSection selectedEnvironmentIds={null} />
            ) : settling ? (
              <UsageSkeleton />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2" aria-label="Date selection">
                  <ToggleGroup
                    aria-label="Usage period"
                    variant="segmented"
                    value={[String(preset)]}
                    onValueChange={(next) => {
                      const value = next[0];
                      if (value === "custom") {
                        setZoomBase(null);
                        setWindowSelection({ preset: "custom", window });
                        return;
                      }
                      const days = WINDOW_OPTIONS.find((o) => String(o.days) === value)?.days;
                      if (days !== undefined) selectPreset(days);
                    }}
                  >
                    {WINDOW_OPTIONS.map((option) => (
                      <Toggle key={option.days} value={String(option.days)}>
                        {option.label}
                      </Toggle>
                    ))}
                    <Toggle value="custom">Custom</Toggle>
                  </ToggleGroup>
                  {preset === "custom" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="From day"
                        type="date"
                        value={window.sinceDay}
                        onChange={(event) => setDate("from", event.target.value)}
                        className="h-7 w-[9.5rem]"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        aria-label="To day"
                        type="date"
                        value={window.untilDay}
                        onChange={(event) => setDate("to", event.target.value)}
                        className="h-7 w-[9.5rem]"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {formatDateTimeShort(window.sinceTime!, window.timeZone)} to{" "}
                      {formatDateTimeShort(untilTime, window.timeZone)}
                    </span>
                  )}
                  <ToggleGroup
                    aria-label="Metric"
                    variant="segmented"
                    value={[metric]}
                    className="ms-auto"
                    onValueChange={(next) => {
                      const value = next[0];
                      if (value === "cost" || value === "tokens")
                        updatePreferences({ metric: value });
                    }}
                  >
                    <Toggle value="cost">Cost</Toggle>
                    <Toggle value="tokens">Tokens</Toggle>
                  </ToggleGroup>
                </div>

                <section aria-label="Usage summary">
                  <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4 text-sm">
                    <Stat
                      label={metric === "cost" ? "API-rate estimate" : "Processed tokens"}
                      value={
                        metric === "cost"
                          ? formatUsd(merged.costUsd)
                          : formatTokens(merged.totalTokens)
                      }
                      detail={
                        merged.sessionsExact
                          ? `${formatCount(merged.sessions)} sessions`
                          : "Session count unavailable at this cutoff"
                      }
                    />
                    <Stat
                      label={metric === "cost" ? "Tokens" : "Cost"}
                      value={
                        metric === "cost"
                          ? formatTokens(merged.totalTokens)
                          : formatUsd(merged.costUsd)
                      }
                      detail={`${formatTokens(merged.cachedInputTokens)} cached · ${formatTokens(
                        merged.uncachedInputTokens,
                      )} uncached · ${formatTokens(merged.outputTokens)} output`}
                    />
                    <Stat
                      label="Cache writes, estimated"
                      value={
                        merged.costQuality.cacheWriteUsd === null
                          ? "Unavailable"
                          : formatUsd(merged.costQuality.cacheWriteUsd)
                      }
                      detail={`${formatTokens(merged.cacheCreationTokens)} tokens written`}
                    />
                    <Stat
                      label="Cache savings"
                      value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                      detail="vs. paying full input rates"
                    />
                  </dl>
                </section>

                <StatusLine
                  environments={environments}
                  availableThrough={merged.availableThroughTime}
                  lastUpdatedAt={merged.lastUpdatedAt}
                  isPartial={isPartial}
                  isRefreshing={isRefreshing}
                  refreshError={refreshError}
                  timeZone={window.timeZone}
                />

                {budgetAlert === null ? null : (
                  <Alert variant="warning" controlAlignment="first-line">
                    <AlertTriangleIcon aria-hidden />
                    <AlertTitle>
                      {budgetAlert.level === "pause"
                        ? "Usage pause level reached"
                        : budgetAlert.level === "approval"
                          ? "Usage approval level reached"
                          : "Usage warning level reached"}
                    </AlertTitle>
                    <AlertDescription>
                      {formatUsd(budgetAlert.valueUsd)} on {formatDayShort(budgetAlert.day)} reached
                      the {budgetAlert.level} level.
                    </AlertDescription>
                  </Alert>
                )}

                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ToggleGroup
                      aria-label="Breakdown dimension"
                      variant="segmented"
                      value={[dimension]}
                      onValueChange={(next) => {
                        const value = DIMENSION_OPTIONS.find((o) => o.value === next[0])?.value;
                        if (value !== undefined) {
                          updatePreferences({ dimension: value });
                          setActiveSeries(null);
                        }
                      }}
                    >
                      {DIMENSION_OPTIONS.map((option) => (
                        <Toggle key={option.value} value={option.value}>
                          {option.label}
                        </Toggle>
                      ))}
                    </ToggleGroup>
                    <Menu>
                      <MenuTrigger
                        render={<Button variant="ghost" size="sm" className="ms-auto" />}
                        aria-label="Chart grouping"
                      >
                        <span className="text-muted-foreground">Group</span>
                        {preferences.grouping === "auto" ? `Auto · ${grouping}` : grouping}
                        <ChevronDownIcon aria-hidden className="size-3 opacity-60" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuRadioGroup
                          value={preferences.grouping}
                          onValueChange={(value) => {
                            const option = GROUPING_OPTIONS.find((o) => o.value === value);
                            if (option) updatePreferences({ grouping: option.value });
                          }}
                        >
                          {GROUPING_OPTIONS.map((option) => (
                            <MenuRadioItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuPopup>
                    </Menu>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Drag to select a time range · double-click to reset</span>
                    {zoomBase ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setWindowSelection(zoomBase);
                          setZoomBase(null);
                        }}
                      >
                        Reset zoom
                      </Button>
                    ) : null}
                  </div>
                  <UsageStackedChart
                    key={`${window.sinceTime}:${untilTime}`}
                    onSelectRange={(range) => {
                      setZoomBase((base) => base ?? windowSelection);
                      setWindowSelection({
                        preset: "selection",
                        window: selectedUsageWindow(window, range),
                      });
                      setActiveSeries(null);
                    }}
                    onResetRange={() => {
                      if (zoomBase) {
                        setWindowSelection(zoomBase);
                        setZoomBase(null);
                      }
                    }}
                    cells={chartCells}
                    series={series}
                    visibleSeries={visibleSeries}
                    seriesMode={seriesMode}
                    metric={metric}
                    grouping={grouping}
                    sourceResolution={window.resolution ?? "day"}
                    sinceTime={window.sinceTime!}
                    untilTime={untilTime}
                    timeZone={window.timeZone}
                    activeSeries={activeSeries}
                    onActiveSeriesChange={setActiveSeries}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-medium">Breakdown</h2>
                      <p className="text-xs text-muted-foreground">
                        {dimension === "projects"
                          ? "Expand a project for threads. Star favorites to keep them first."
                          : "Use the colored rows to show or hide chart series."}
                      </p>
                    </div>
                    <UsageColumns
                      showSessions={dimension === "providers"}
                      hidden={preferences.hiddenColumns ?? []}
                      onChange={(hiddenColumns) => {
                        const nextSort = { ...preferences.sort };
                        for (const view of [
                          ...DIMENSION_OPTIONS.map((entry) => entry.value),
                          "threads",
                        ] as const) {
                          const selected = nextSort[view];
                          if (
                            selected &&
                            selected.column !== "name" &&
                            hiddenColumns.includes(selected.column)
                          ) {
                            nextSort[view] = { column: "name", direction: "asc" };
                          }
                        }
                        updatePreferences({ hiddenColumns, sort: nextSort });
                      }}
                    />
                  </div>
                  {dimension === "projects" ? (
                    <UsageBreakdownTable
                      ariaLabel="Project breakdown"
                      nameLabel="Project"
                      favoriteProjects={preferences.favoriteProjects ?? []}
                      onToggleFavorite={(key) =>
                        updatePreferences({
                          favoriteProjects: [
                            ...setToggled(new Set(preferences.favoriteProjects), key),
                          ],
                        })
                      }
                      renderThreads={(key, columns) => {
                        const project = merged.projects.find(
                          (entry) => projectSeriesKey(entry.projectKey) === key,
                        );
                        if (!project) return null;
                        return (
                          <UsageProjectThreads
                            projectLabel={projectLabel(project)}
                            input={{ ...threadInput, projectKey: project.projectKey }}
                            providerContributions={merged.providerContributions}
                            summaryFailedEnvironments={
                              environments.filter(
                                (entry) =>
                                  entry.error !== null ||
                                  merged.staleEnvironments.includes(entry.environmentId),
                              ).length
                            }
                            models={modelsByProject.get(key) ?? []}
                            columns={columns}
                            metric={metric}
                            sort={
                              preferences.sort.threads ??
                              defaultBreakdownSort(metric, preferences.hiddenColumns)
                            }
                            onSort={(column) =>
                              updatePreferences({
                                sort: {
                                  ...preferences.sort,
                                  threads: toggleBreakdownSort(
                                    preferences.sort.threads ??
                                      defaultBreakdownSort(metric, preferences.hiddenColumns),
                                    column,
                                  ),
                                },
                              })
                            }
                          />
                        );
                      }}
                      rows={projectRows}
                      metric={metric}
                      sort={sort}
                      onSort={onSort}
                      hiddenColumns={preferences.hiddenColumns ?? []}
                      hidden={hiddenProjects}
                      onToggleHidden={(key) => setHiddenProjects((c) => setToggled(c, key))}
                      onSetAllHidden={(hidden) =>
                        setHiddenProjects(
                          hidden ? new Set(projectRows.map((r) => r.key)) : new Set(),
                        )
                      }
                      activeKey={activeSeries}
                      onActiveKeyChange={setActiveSeries}
                    />
                  ) : dimension === "providers" ? (
                    <UsageBreakdownTable
                      ariaLabel="Provider breakdown"
                      nameLabel="Provider"
                      rows={providerRows}
                      metric={metric}
                      sort={sort}
                      onSort={onSort}
                      hiddenColumns={preferences.hiddenColumns ?? []}
                      hidden={hiddenProviders}
                      onToggleHidden={(key) =>
                        setHiddenProviders((c) => setToggled(c, key as UsageProviderKind))
                      }
                      onSetAllHidden={(hidden) =>
                        setHiddenProviders(
                          hidden ? new Set(providerRows.map((r) => r.key)) : new Set(),
                        )
                      }
                      activeKey={activeSeries}
                      onActiveKeyChange={setActiveSeries}
                      showSessions
                    />
                  ) : (
                    <UsageBreakdownTable
                      ariaLabel="Model breakdown"
                      nameLabel="Model"
                      rows={modelRows}
                      metric={metric}
                      sort={sort}
                      onSort={onSort}
                      hiddenColumns={preferences.hiddenColumns ?? []}
                      hidden={hiddenModels}
                      onToggleHidden={(key) => setHiddenModels((c) => setToggled(c, key))}
                      onSetAllHidden={(hidden) =>
                        setHiddenModels(hidden ? new Set(modelRows.map((r) => r.key)) : new Set())
                      }
                      activeKey={activeSeries}
                      onActiveKeyChange={setActiveSeries}
                    />
                  )}
                </section>
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
      {modelPricesOpen ? (
        <UsagePriceOverrides
          usage={environments}
          initialSelectedEnvironmentIds={null}
          onOpenChange={setModelPricesOpen}
        />
      ) : null}
    </SidebarInset>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium tabular-nums">{value}</dd>
      <dd className="truncate text-[11px] text-muted-foreground/80">{detail}</dd>
    </div>
  );
}

/**
 * One quiet line about data freshness, with problems called out separately so
 * a healthy page never shows a warning-shaped box.
 */
function StatusLine({
  environments,
  availableThrough,
  lastUpdatedAt,
  isPartial,
  isRefreshing,
  refreshError,
  timeZone,
}: {
  readonly environments: readonly { readonly label: string; readonly error: string | null }[];
  readonly availableThrough: string | null;
  readonly lastUpdatedAt: string | null;
  readonly isPartial: boolean;
  readonly isRefreshing: boolean;
  readonly refreshError: string | null | undefined;
  readonly timeZone: string;
}) {
  const failed = environments.filter((entry) => entry.error !== null);
  const problems = [
    ...(isPartial ? ["Some environments are still reporting."] : []),
    ...(refreshError ? [refreshError] : []),
    ...failed.map((entry) => `${entry.label} could not report usage.`),
  ];
  if (availableThrough === null && lastUpdatedAt === null && problems.length === 0 && !isRefreshing)
    return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        {availableThrough
          ? `Data through ${formatDateTimeShort(availableThrough, timeZone)}`
          : null}
        {lastUpdatedAt ? ` · updated ${formatDateTimeShort(lastUpdatedAt, timeZone)}` : null}
        {" · refreshes every 30 minutes"}
        {isRefreshing ? " · refreshing now" : null}
      </p>
      {problems.length === 0 ? null : (
        <p className="flex items-center gap-1.5 text-warning">
          <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0" />
          <span>{problems.join(" ")}</span>
        </p>
      )}
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-60 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
