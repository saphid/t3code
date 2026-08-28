import { AlertTriangleIcon, PanelTopOpenIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useMemo, type ReactNode } from "react";
import * as Option from "effect/Option";

import { formatDiagnosticsDescription } from "./SettingsPanels.logic";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerObservabilityAtom, serverEnvironment } from "../../state/server";
import { usePrimaryEnvironment } from "../../state/environments";
import { useRendererPerformance } from "../../hooks/useRendererPerformance";
import { useResourceTelemetry } from "../../lib/resourceTelemetryState";
import { Button } from "../ui/button";
import { DiagnosticsRefreshButton, StatBlock, StatsGrid } from "./DiagnosticsSettings";
import { categoryLabel, formatProcessName } from "./ResourceTelemetryDiagnostics";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import {
  appGpuPercent,
  formatStatBytes,
  formatStatCount,
  formatStatPercent,
  topProcessesByCpu,
} from "./StatsForNerds.logic";

const TOP_PROCESS_LIMIT = 8;

function SectionNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
      {children}
    </div>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 border-t border-border/60 px-4 py-3 text-xs text-destructive sm:px-5">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function StatsForNerdsPanel() {
  const openStatsWindow = window.desktopBridge?.openStatsWindow;
  const observability = useAtomValue(primaryServerObservabilityAtom);
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const telemetry = useResourceTelemetry();
  const renderer = useRendererPerformance();
  const traces = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );

  const snapshot = telemetry.data;
  const topProcesses = useMemo(
    () => (snapshot ? topProcessesByCpu(snapshot.processes, TOP_PROCESS_LIMIT) : []),
    [snapshot],
  );
  const appGpu = snapshot === null ? null : appGpuPercent(snapshot.gpu, snapshot.processes);
  const gpuAvailable = appGpu !== null;
  const deviceGpu = snapshot?.gpu?.deviceUtilizationPercent ?? null;
  const traceData = traces.data;
  const traceError = traceData ? Option.getOrNull(traceData.error) : null;
  const otelDescription = formatDiagnosticsDescription({
    localTracingEnabled: observability?.localTracingEnabled ?? false,
    otlpTracesEnabled: observability?.otlpTracesEnabled ?? false,
    otlpTracesUrl: observability?.otlpTracesUrl,
    otlpMetricsEnabled: observability?.otlpMetricsEnabled ?? false,
    otlpMetricsUrl: observability?.otlpMetricsUrl,
  });

  return (
    <SettingsPageContainer width="expanded" className="gap-10">
      <SettingsSection
        title="Application"
        headerAction={
          <div className="flex items-center gap-1">
            {openStatsWindow ? (
              <Button
                size="xs"
                variant="ghost-muted"
                className="text-[11px]"
                onClick={() => void openStatsWindow()}
              >
                <PanelTopOpenIcon className="size-3" />
                Open window
              </Button>
            ) : null}
            <Button
              render={<Link to="/settings/diagnostics" />}
              size="xs"
              variant="ghost-muted"
              className="text-[11px]"
            >
              Full diagnostics
            </Button>
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label="CPU"
            value={snapshot ? formatStatPercent(snapshot.groups.allT3.currentCpuPercent) : "..."}
            tooltip="Total CPU across every T3 Code process: the desktop shell, the server, and the agents it runs. 100% is one core."
          />
          <StatBlock
            label="Memory"
            value={snapshot ? formatStatBytes(snapshot.groups.allT3.currentRssBytes) : "..."}
            tooltip="Total resident memory across every T3 Code process."
          />
          <StatBlock
            label="GPU"
            value={snapshot === null ? "..." : gpuAvailable ? formatStatPercent(appGpu) : "n/a"}
            tooltip={
              gpuAvailable
                ? `GPU busy time attributed to T3 Code processes over the last sample. Whole device: ${formatStatPercent(deviceGpu)}.`
                : "Per-process GPU attribution needs the desktop app on macOS (Apple Silicon) or Linux."
            }
          />
          <StatBlock
            label="Processes"
            value={snapshot ? formatStatCount(snapshot.groups.allT3.processCount) : "..."}
            tooltip="Every process T3 Code is responsible for: the desktop shell, the server, providers, and terminals."
          />
        </StatsGrid>
        <div className="w-full border-t border-border/60">
          <table className="w-full table-fixed text-left text-xs">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[20%]" />
              <col className="w-[12%]" />
              {gpuAvailable ? <col className="w-[12%]" /> : null}
              <col className="w-[14%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="border-b border-border/60 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
              <tr>
                <th className="px-4 py-2 font-semibold sm:pl-5">Process</th>
                <th className="px-3 py-2 font-semibold">Category</th>
                <th className="px-3 py-2 text-right font-semibold">CPU</th>
                {gpuAvailable ? <th className="px-3 py-2 text-right font-semibold">GPU</th> : null}
                <th className="px-3 py-2 text-right font-semibold">Memory</th>
                <th className="px-3 py-2 text-right font-semibold sm:pr-5">PID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {topProcesses.length === 0 ? (
                <tr>
                  <td
                    colSpan={gpuAvailable ? 6 : 5}
                    className="px-4 py-5 text-xs text-muted-foreground sm:px-5"
                  >
                    Waiting for resource telemetry.
                  </td>
                </tr>
              ) : null}
              {topProcesses.map((process) => (
                <tr key={`${process.identity.pid}-${process.identity.startTimeMs}`}>
                  <td className="truncate px-4 py-2 font-medium sm:pl-5">
                    {formatProcessName(process)}
                  </td>
                  <td className="truncate px-3 py-2 text-[11px] text-muted-foreground">
                    {categoryLabel(process.category)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatStatPercent(process.cpuPercent)}
                  </td>
                  {gpuAvailable ? (
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {process.gpuPercent === undefined
                        ? "–"
                        : formatStatPercent(process.gpuPercent)}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatStatBytes(process.residentBytes)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground sm:pr-5">
                    {process.identity.pid}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {telemetry.error ? <SectionError message={telemetry.error} /> : null}
        <SectionNote>
          The {TOP_PROCESS_LIMIT} busiest T3 Code processes by CPU, updated live while this page is
          open. The full process tree, IO rates, and history live in diagnostics.
        </SectionNote>
      </SettingsSection>

      <SettingsSection title="This Window">
        <StatsGrid>
          <StatBlock
            label="JS Heap"
            value={formatStatBytes(renderer.jsHeapUsedBytes)}
            tooltip={
              renderer.jsHeapLimitBytes === null
                ? "JavaScript heap counters are only exposed by Chromium."
                : `Allocated ${formatStatBytes(renderer.jsHeapTotalBytes)} of a ${formatStatBytes(renderer.jsHeapLimitBytes)} limit.`
            }
          />
          <StatBlock label="DOM Nodes" value={formatStatCount(renderer.domNodeCount)} />
          <StatBlock
            label="Frame Rate"
            value={renderer.framesPerSecond === null ? "..." : `${renderer.framesPerSecond} fps`}
            tooltip="Frames this window rendered in the last second. An idle window renders few frames on purpose; the number matters while you interact."
          />
          <StatBlock
            label="Long Tasks"
            value={formatStatCount(renderer.longTasks.count)}
            tone={renderer.longTasks.count > 0 ? "warning" : "default"}
            tooltip={`Main-thread tasks over 50 ms in the last 30 s. Blocked ${Math.round(renderer.longTasks.totalMs)} ms in total; the longest took ${Math.round(renderer.longTasks.longestMs)} ms.`}
          />
        </StatsGrid>
        <SectionNote>
          This UI window only, measured on this device. Sampling runs only while this page is open
          and visible.
        </SectionNote>
      </SettingsSection>

      <SettingsSection
        title="Telemetry"
        headerAction={
          <DiagnosticsRefreshButton
            isPending={traces.isPending}
            label="Refresh trace diagnostics"
            onClick={traces.refresh}
          />
        }
      >
        <StatsGrid>
          <StatBlock
            label="Spans"
            value={traceData ? formatStatCount(traceData.recordCount) : "..."}
            tooltip="Trace records in the local trace file. This is what would be exported to an OTLP collector when one is configured."
          />
          <StatBlock
            label="Failures"
            value={traceData ? formatStatCount(traceData.failureCount) : "..."}
            tone={traceData !== null && traceData.failureCount > 0 ? "warning" : "default"}
          />
          <StatBlock
            label="Slow Spans"
            value={traceData ? formatStatCount(traceData.slowSpanCount) : "..."}
            tooltip={
              traceData
                ? `Spans over ${formatStatCount(traceData.slowSpanThresholdMs)} ms.`
                : undefined
            }
          />
          <StatBlock
            label="Parse Errors"
            value={traceData ? formatStatCount(traceData.parseErrorCount) : "..."}
            tone={traceData !== null && traceData.parseErrorCount > 0 ? "danger" : "default"}
          />
        </StatsGrid>
        {traceError ? <SectionError message={traceError.message} /> : null}
        <SectionNote>
          {otelDescription} Failure details, slow spans, and span logs live in{" "}
          <Link to="/settings/diagnostics" className="text-foreground underline underline-offset-2">
            diagnostics
          </Link>
          ; OTLP export endpoints are configured in{" "}
          <Link to="/settings/general" className="text-foreground underline underline-offset-2">
            general settings
          </Link>
          .
        </SectionNote>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
