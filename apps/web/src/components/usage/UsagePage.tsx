import type { UsageProviderKind } from "@t3tools/contracts";
import { AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatPercent,
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
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { UsageLimitsSection } from "./UsageLimits";
import { UsageThreadTable } from "./UsageThreadTable";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION, providersWithUsage } from "./usageProviders";
import { evaluateDailyUsageBudget } from "./usageBudget";
import {
  projectSeriesKey,
  UsageStackedChart,
  type UsageChartSeries,
  type UsageGrouping,
  type UsageSeriesMode,
  type UsageStackMetric,
} from "./UsageStackedChart";

const WINDOW_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 1, label: "24 hours" },
] as const;
const GROUP_OPTIONS: readonly { value: UsageGrouping; label: string }[] = [
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "12h", label: "12h" },
  { value: "1d", label: "1d" },
];
const PROJECT_COLORS = [
  "#4f7dd9",
  "#d8a20b",
  "#7e62c6",
  "#d66a45",
  "#3f9b7a",
  "#b75b93",
  "#6e8b3d",
  "#b27635",
  "#4d92a8",
  "#8e6f5a",
  "#6f7f9e",
  "#777777",
] as const;

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

export function UsagePage() {
  const [view, setView] = useState<"usage" | "limits">("usage");
  const [metric, setMetric] = useState<UsageStackMetric>("cost");
  const [seriesMode, setSeriesMode] = useState<UsageSeriesMode>("projects");
  const [grouping, setGrouping] = useState<UsageGrouping>("12h");
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: 7,
    window: exactWindow(7),
  }));
  const [hiddenProjects, setHiddenProjects] = useState<ReadonlySet<string>>(new Set());
  const [hiddenProviders, setHiddenProviders] = useState<ReadonlySet<UsageProviderKind>>(new Set());
  const [hiddenModels, setHiddenModels] = useState<ReadonlySet<string>>(new Set());
  const [expandedProviders, setExpandedProviders] = useState<ReadonlySet<UsageProviderKind>>(
    new Set(PROVIDER_ORDER),
  );
  const [activeSeries, setActiveSeries] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<"projects" | "threads">("projects");

  const { days: windowDays, window } = windowSelection;
  const { merged, environments, isPending, isPartial, isRefreshing, refreshError, refresh } =
    useUsage(window);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const settling = isPending && merged.availableThroughDay === null;
  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);

  const modelsByProvider = useMemo(
    () =>
      new Map(
        PROVIDER_ORDER.map((provider) => [
          provider,
          merged.models.filter((model) => model.provider === provider),
        ]),
      ),
    [merged.models],
  );
  const visibleModels = useMemo(() => {
    const values = new Set<string>();
    for (const model of merged.models) {
      if (hiddenProviders.has(model.provider)) continue;
      const key = `${model.provider}\u0000${model.model}`;
      if (!hiddenModels.has(key)) values.add(key);
    }
    return values;
  }, [hiddenModels, hiddenProviders, merged.models]);

  const projectSeries = useMemo<readonly UsageChartSeries[]>(() => {
    const values: UsageChartSeries[] = merged.projects.map((project, index) => ({
      key: projectSeriesKey(project.projectKey),
      label: projectLabel(project),
      color: PROJECT_COLORS[index % PROJECT_COLORS.length]!,
    }));
    if (merged.timeline.some((cell) => cell.projectKey === undefined)) {
      values.push({ key: "unknown", label: "Unknown attribution", color: "#777777" });
    }
    return values;
  }, [merged.projects, merged.timeline]);
  const providerSeries = useMemo<readonly UsageChartSeries[]>(
    () =>
      activeProviders.map((provider) => ({
        key: provider,
        label: PROVIDER_PRESENTATION[provider].label,
        color: PROVIDER_PRESENTATION[provider].color,
      })),
    [activeProviders],
  );
  const series = seriesMode === "projects" ? projectSeries : providerSeries;
  const visibleSeries = useMemo(
    () =>
      new Set(
        series
          .filter((entry) =>
            seriesMode === "projects"
              ? !hiddenProjects.has(entry.key)
              : !hiddenProviders.has(entry.key as UsageProviderKind),
          )
          .map((entry) => entry.key),
      ),
    [hiddenProjects, hiddenProviders, series, seriesMode],
  );
  const colorByProject = useMemo(
    () => new Map(projectSeries.map((entry) => [entry.key, entry.color])),
    [projectSeries],
  );
  const projectRows = useMemo(
    () =>
      [...merged.projects].sort((left, right) =>
        metric === "cost" ? right.costUsd - left.costUsd : right.totalTokens - left.totalTokens,
      ),
    [merged.projects, metric],
  );
  const budgetAlert = useMemo(
    () => evaluateDailyUsageBudget(merged.daily, window.untilDay),
    [merged.daily, window.untilDay],
  );

  const selectWindow = (days: number) => setWindowSelection({ days, window: exactWindow(days) });
  const setDate = (edge: "from" | "to", value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const nextSince = edge === "from" ? localDayBoundary(value, false) : window.sinceTime!;
    const nextUntil = edge === "to" ? localDayBoundary(value, true) : window.untilTime!;
    if (nextSince === null || nextUntil === null) return;
    if (Date.parse(nextUntil) <= Date.parse(nextSince)) return;
    if (Date.parse(nextUntil) - Date.parse(nextSince) > 90 * 24 * 60 * 60_000) return;
    setWindowSelection({
      days: windowDays,
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
    const nextWindow = exactWindow(windowDays);
    setWindowSelection({ days: windowDays, window: nextWindow });
    refresh(nextWindow);
  };

  const topbar = (
    <div className="flex w-full min-w-0 items-center gap-3">
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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader electron={isElectron}>{topbar}</WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {view === "limits" ? (
              <UsageLimitsSection />
            ) : settling ? (
              <UsageSkeleton />
            ) : (
              <>
                <div
                  className="flex items-center gap-2 overflow-x-auto whitespace-nowrap"
                  aria-label="Date selection"
                >
                  <ToggleGroup
                    aria-label="Usage period"
                    variant="segmented"
                    value={[String(windowDays)]}
                    onValueChange={(next) => {
                      if (next[0]) selectWindow(Number(next[0]));
                    }}
                  >
                    {WINDOW_OPTIONS.map((option) => (
                      <Toggle key={option.days} value={String(option.days)}>
                        {option.label}
                      </Toggle>
                    ))}
                  </ToggleGroup>
                  <Input
                    aria-label="From day"
                    type="date"
                    value={window.sinceDay}
                    onChange={(event) => setDate("from", event.target.value)}
                    className="h-8 w-[9.5rem]"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    aria-label="To day"
                    type="date"
                    value={window.untilDay}
                    onChange={(event) => setDate("to", event.target.value)}
                    className="h-8 w-[9.5rem]"
                  />
                </div>

                <CoverageNotice
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

                <section className="grid gap-5 lg:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)]">
                  <aside className="flex min-w-0 flex-col gap-2">
                    <div className="mb-2">
                      <div className="text-3xl font-semibold tabular-nums">
                        {metric === "cost"
                          ? formatUsd(merged.costUsd)
                          : formatTokens(merged.totalTokens)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {merged.sessionsExact
                          ? `${formatCount(merged.sessions)} sessions · API estimate`
                          : "Session count unavailable at this cutoff"}
                      </div>
                    </div>
                    <div className="text-xs font-medium text-muted-foreground">
                      Providers and models · click to hide or show
                    </div>
                    {activeProviders.map((provider) => {
                      const expanded = expandedProviders.has(provider);
                      const hidden = hiddenProviders.has(provider);
                      const totals = merged.providers.find((entry) => entry.provider === provider);
                      return (
                        <div key={provider} className="border-b border-border/50 pb-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={`${expanded ? "Collapse" : "Expand"} ${PROVIDER_PRESENTATION[provider].label}`}
                              onClick={() =>
                                setExpandedProviders((current) => setToggled(current, provider))
                              }
                              className="p-1 text-muted-foreground"
                            >
                              {expanded ? (
                                <ChevronDownIcon className="size-3.5" />
                              ) : (
                                <ChevronRightIcon className="size-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-pressed={!hidden}
                              onClick={() =>
                                setHiddenProviders((current) => setToggled(current, provider))
                              }
                              className={cn(
                                "flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-1 py-1 text-sm",
                                hidden && "opacity-35 line-through",
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className="size-2.5 rounded-sm"
                                  style={{ backgroundColor: PROVIDER_PRESENTATION[provider].color }}
                                />
                                <span className="truncate">
                                  {PROVIDER_PRESENTATION[provider].label}
                                </span>
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {metric === "cost"
                                  ? formatUsd(totals?.costUsd ?? 0)
                                  : formatTokens(totals?.totalTokens ?? 0)}
                              </span>
                            </button>
                          </div>
                          {expanded ? (
                            <div className="ml-7 flex flex-col">
                              {(modelsByProvider.get(provider) ?? []).map((model) => {
                                const key = `${provider}\u0000${model.model}`;
                                const modelHidden = hiddenModels.has(key);
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    aria-pressed={!modelHidden}
                                    onClick={() =>
                                      setHiddenModels((current) => setToggled(current, key))
                                    }
                                    className={cn(
                                      "flex items-center justify-between gap-2 rounded px-1 py-1 text-left text-xs",
                                      modelHidden && "opacity-35 line-through",
                                    )}
                                  >
                                    <span className="truncate">{model.model}</span>
                                    <span className="tabular-nums text-muted-foreground">
                                      {metric === "cost"
                                        ? formatUsd(model.costUsd)
                                        : formatTokens(model.totalTokens)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </aside>

                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ToggleGroup
                        aria-label="Chart series"
                        variant="segmented"
                        value={[seriesMode]}
                        onValueChange={(next) => {
                          const value = next[0];
                          if (value === "projects" || value === "providers") {
                            setSeriesMode(value);
                            setActiveSeries(null);
                          }
                        }}
                      >
                        <Toggle value="providers">Providers</Toggle>
                        <Toggle value="projects">Projects</Toggle>
                      </ToggleGroup>
                      <ToggleGroup
                        aria-label="Chart grouping"
                        variant="segmented"
                        value={[grouping]}
                        onValueChange={(next) => {
                          const value = next[0] as UsageGrouping | undefined;
                          if (value) setGrouping(value);
                        }}
                      >
                        {GROUP_OPTIONS.map((option) => (
                          <Toggle key={option.value} value={option.value}>
                            {option.label}
                          </Toggle>
                        ))}
                      </ToggleGroup>
                      <ToggleGroup
                        aria-label="Chart metric"
                        variant="segmented"
                        value={[metric]}
                        className="ms-auto"
                        onValueChange={(next) => {
                          const value = next[0];
                          if (value === "cost" || value === "tokens") setMetric(value);
                        }}
                      >
                        <Toggle value="cost">Cost</Toggle>
                        <Toggle value="tokens">Tokens</Toggle>
                      </ToggleGroup>
                    </div>
                    <UsageStackedChart
                      cells={merged.timeline}
                      series={series}
                      visibleSeries={visibleSeries}
                      visibleModels={visibleModels}
                      seriesMode={seriesMode}
                      metric={metric}
                      grouping={grouping}
                      sinceTime={window.sinceTime!}
                      untilTime={merged.availableThroughTime ?? window.untilTime!}
                      timeZone={window.timeZone}
                      activeSeries={activeSeries}
                      onActiveSeriesChange={setActiveSeries}
                      onToggleSeries={(key) =>
                        seriesMode === "projects"
                          ? setHiddenProjects((current) => setToggled(current, key))
                          : setHiddenProviders((current) =>
                              setToggled(current, key as UsageProviderKind),
                            )
                      }
                      onSelectAll={() =>
                        seriesMode === "projects"
                          ? setHiddenProjects(new Set())
                          : setHiddenProviders(new Set())
                      }
                      onDeselectAll={() =>
                        seriesMode === "projects"
                          ? setHiddenProjects(new Set(series.map((entry) => entry.key)))
                          : setHiddenProviders(new Set(activeProviders))
                      }
                    />
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-6">
                  <Metric label="Processed tokens" value={formatTokens(merged.totalTokens)} />
                  <Metric label="Cached input" value={formatTokens(merged.cachedInputTokens)} />
                  <Metric label="Uncached input" value={formatTokens(merged.uncachedInputTokens)} />
                  <Metric label="Output" value={formatTokens(merged.outputTokens)} />
                  <Metric
                    label="Cache writes, estimated"
                    value={
                      merged.costQuality.cacheWriteUsd === null
                        ? "Unavailable"
                        : formatUsd(merged.costQuality.cacheWriteUsd)
                    }
                  />
                  <Metric
                    label="Cache savings"
                    value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                  />
                </section>

                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium">Breakdown</h2>
                    <ToggleGroup
                      aria-label="Usage breakdown"
                      variant="segmented"
                      value={[breakdown]}
                      onValueChange={(next) => {
                        const value = next[0];
                        if (value === "projects" || value === "threads") setBreakdown(value);
                      }}
                    >
                      <Toggle value="projects">Projects</Toggle>
                      <Toggle value="threads">Threads</Toggle>
                    </ToggleGroup>
                  </div>
                  {breakdown === "threads" ? (
                    <UsageThreadTable
                      input={{
                        sinceDay: window.sinceDay,
                        untilDay: window.untilDay,
                        timeZone: window.timeZone,
                        ...(window.sinceTime === undefined ? {} : { sinceTime: window.sinceTime }),
                        ...(window.untilTime === undefined ? {} : { untilTime: window.untilTime }),
                      }}
                      providerContributions={merged.providerContributions}
                      summaryFailedEnvironments={
                        environments.filter(
                          (entry) =>
                            entry.error !== null ||
                            merged.staleEnvironments.includes(entry.environmentId),
                        ).length
                      }
                    />
                  ) : (
                    <div className="flex flex-col" aria-label="Project breakdown">
                      {projectRows.map((project) => {
                        const key = projectSeriesKey(project.projectKey);
                        const hidden = hiddenProjects.has(key);
                        const highlighted = activeSeries === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={!hidden}
                            onClick={() => setHiddenProjects((current) => setToggled(current, key))}
                            onPointerEnter={() => setActiveSeries(key)}
                            onPointerLeave={() => setActiveSeries(null)}
                            className={cn(
                              "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-border/50 px-1 py-2 text-left text-sm transition-opacity",
                              hidden && "opacity-35 line-through",
                              highlighted && "bg-muted font-medium",
                              activeSeries !== null && !highlighted && "opacity-25",
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="size-3 rounded-[3px]"
                                style={{ backgroundColor: colorByProject.get(key) }}
                              />
                              <span className="truncate">{projectLabel(project)}</span>
                            </span>
                            <span className="tabular-nums">
                              {metric === "cost"
                                ? formatUsd(project.costUsd)
                                : formatTokens(project.totalTokens)}
                            </span>
                            <span className="w-14 text-right tabular-nums text-muted-foreground">
                              {formatPercent(
                                metric === "cost"
                                  ? project.costShare
                                  : merged.totalTokens === 0
                                    ? 0
                                    : project.totalTokens / merged.totalTokens,
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium tabular-nums">{value}</span>
    </div>
  );
}

function CoverageNotice({
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
  if (
    failed.length === 0 &&
    !isPartial &&
    !isRefreshing &&
    !refreshError &&
    availableThrough === null &&
    lastUpdatedAt === null
  )
    return null;
  return (
    <div className="border border-border px-3 py-2 text-xs text-muted-foreground">
      <span>Usage snapshots refresh automatically every 30 minutes. </span>
      {availableThrough ? (
        <span>Data through {formatDateTimeShort(availableThrough, timeZone)}. </span>
      ) : null}
      {lastUpdatedAt ? <span>Updated {formatDateTimeShort(lastUpdatedAt, timeZone)}. </span> : null}
      {isPartial ? <span>Some environments are still reporting. </span> : null}
      {isRefreshing ? <span>Refreshing usage. </span> : null}
      {refreshError ? <span>{refreshError} </span> : null}
      {failed.map((entry) => (
        <span key={entry.label}>{entry.label} could not report usage. </span>
      ))}
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-full" />
      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}
