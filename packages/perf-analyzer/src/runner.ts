// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side benchmark runner; runs outside the Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { launchEnv, type LaunchedEnv, type NetworkProfileName, type Surface } from "./launch.ts";
import { MetricsWindow, type WindowMetrics } from "./metrics.ts";
import type { Scenario } from "./scenarios.ts";
import { summarize, type SampleSummary } from "./stats.ts";
import type { FixtureSize } from "./seed.ts";

export interface RunnerOptions {
  readonly runs: number;
  /** Explicit discarded repetitions. Omitted preserves the legacy policy. */
  readonly warmupRuns?: number | undefined;
  readonly headless: boolean;
  readonly outDir: string;
  /** Names what is being measured (e.g. a release version) in results files. */
  readonly label?: string | undefined;
  /** Identifies the build under test (e.g. nightly date or npm version). */
  readonly build?: string | undefined;
  /** Ambient network profile applied to web runs. */
  readonly network?: NetworkProfileName | undefined;
  /** Unique fleet execution id, shared by every combo and exported as a label. */
  readonly runId?: string | undefined;
}

/** Ordered execution policy; false is discarded and true is retained. */
export function scenarioRunPlan(
  freshEnvironment: boolean,
  measuredRuns: number,
  explicitWarmupRuns?: number,
): ReadonlyArray<boolean> {
  const warmupRuns = explicitWarmupRuns ?? (freshEnvironment ? 0 : 1);
  return [
    ...Array.from({ length: warmupRuns }, () => false),
    ...Array.from({ length: measuredRuns }, () => true),
  ];
}

export interface ScenarioResult {
  readonly scenario: string;
  readonly surface: Surface;
  readonly size: FixtureSize;
  /** Release/build label when comparing versions; absent for repo builds. */
  readonly label?: string;
  /** Build under test; dashboards use it as the comparison axis. */
  readonly build?: string;
  /** Ambient network profile the runs used; absent means good/direct. */
  readonly network?: string;
  /** Unique fleet execution id. */
  readonly runId?: string;
  readonly runs: ReadonlyArray<WindowMetrics>;
  readonly summary: {
    readonly wallMs: SampleSummary;
    readonly appGpuMsPerSecond: SampleSummary;
    readonly scriptDurationMs: SampleSummary | null;
    readonly layoutDurationMs: SampleSummary | null;
    readonly layoutCount: SampleSummary | null;
    readonly jsHeapUsedBytes: SampleSummary | null;
    readonly droppedFrames: SampleSummary | null;
  };
}

function summarizeRuns(runs: ReadonlyArray<WindowMetrics>): ScenarioResult["summary"] {
  const renderer = runs.map((run) => run.renderer).filter((entry) => entry !== null);
  const maybe = (values: Array<number>) => (values.length > 0 ? summarize(values) : null);
  const dropped = renderer
    .map((entry) => entry.droppedFrames)
    .filter((value): value is number => value !== null);
  return {
    wallMs: summarize(runs.map((run) => run.wallMs)),
    appGpuMsPerSecond: summarize(runs.map((run) => run.appGpuMsPerSecond)),
    scriptDurationMs: maybe(renderer.map((entry) => entry.scriptDurationMs)),
    layoutDurationMs: maybe(renderer.map((entry) => entry.layoutDurationMs)),
    layoutCount: maybe(renderer.map((entry) => entry.layoutCount)),
    jsHeapUsedBytes: maybe(renderer.map((entry) => entry.jsHeapUsedBytes)),
    droppedFrames: maybe(dropped),
  };
}

async function runOnce(
  scenario: Scenario,
  surface: Surface,
  size: FixtureSize,
  options: RunnerOptions,
  reusedEnv: LaunchedEnv | null,
): Promise<WindowMetrics> {
  if (scenario.freshEnv === true || reusedEnv === null) {
    // For startup-style scenarios the launch itself is part of the measured
    // unit, so wall time starts before the environment exists.
    const startedAt = Date.now();
    const env = await launchEnv({
      surface,
      size,
      headless: options.headless,
      shape: scenario.shape,
      network: options.network,
      streamingProvider: scenario.streamingProvider,
      secondServer: scenario.secondServer,
    });
    try {
      if (scenario.prepare !== undefined) await scenario.prepare({ env, page: env.page, size });
      const window = await MetricsWindow.start(env, env.page);
      await scenario.run({ env, page: env.page, size });
      const metrics = await window.end();
      if (scenario.measureFromLaunch !== true) return metrics;
      // Launch time happens before the metrics window can attach; fold it in.
      const launchMs = Date.now() - startedAt - metrics.wallMs;
      return { ...metrics, wallMs: metrics.wallMs + launchMs };
    } finally {
      await env.close().catch(() => undefined);
    }
  }
  if (scenario.prepare !== undefined) {
    await scenario.prepare({ env: reusedEnv, page: reusedEnv.page, size });
  }
  const window = await MetricsWindow.start(reusedEnv, reusedEnv.page);
  await scenario.run({ env: reusedEnv, page: reusedEnv.page, size });
  return await window.end();
}

export async function runScenario(
  scenario: Scenario,
  surface: Surface,
  size: FixtureSize,
  options: RunnerOptions,
  log: (line: string) => void,
): Promise<ScenarioResult> {
  const runs: Array<WindowMetrics> = [];
  let env: LaunchedEnv | null = null;
  try {
    if (scenario.freshEnv !== true) {
      env = await launchEnv({
        surface,
        size,
        headless: options.headless,
        shape: scenario.shape,
        network: options.network,
        streamingProvider: scenario.streamingProvider,
        secondServer: scenario.secondServer,
      });
    }
    let measuredIndex = 0;
    for (const retain of scenarioRunPlan(
      scenario.freshEnv === true,
      options.runs,
      options.warmupRuns,
    )) {
      if (!retain && env !== null) {
        await scenario.run({ env, page: env.page, size });
        continue;
      }
      const metrics = await runOnce(scenario, surface, size, options, env);
      if (!retain) continue;
      runs.push(metrics);
      measuredIndex += 1;
      log(
        `  run ${measuredIndex}/${options.runs}: wall ${Math.round(metrics.wallMs)}ms, gpu ${metrics.appGpuMs.toFixed(1)}ms`,
      );
    }
  } finally {
    if (env !== null) await env.close().catch(() => undefined);
  }
  return {
    scenario: scenario.name,
    surface,
    size,
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.build !== undefined ? { build: options.build } : {}),
    ...(options.network !== undefined && options.network !== "good"
      ? { network: options.network }
      : {}),
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    runs,
    summary: summarizeRuns(runs),
  };
}

function formatMs(summary: SampleSummary | null): string {
  if (summary === null) return "-";
  return `${summary.median.toFixed(0)} (${summary.ci95[0].toFixed(0)}-${summary.ci95[1].toFixed(0)})`;
}

export function renderMarkdown(results: ReadonlyArray<ScenarioResult>): string {
  const lines = [
    "| scenario | surface | size | wall ms (95% CI) | gpu ms/s | script ms | layout ms | layouts | js heap MB | dropped frames |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of results) {
    const summary = result.summary;
    lines.push(
      `| ${result.scenario} | ${result.surface} | ${result.size} | ${formatMs(summary.wallMs)} | ${summary.appGpuMsPerSecond.median.toFixed(1)} | ${formatMs(summary.scriptDurationMs)} | ${formatMs(summary.layoutDurationMs)} | ${summary.layoutCount === null ? "-" : summary.layoutCount.median.toFixed(0)} | ${summary.jsHeapUsedBytes === null ? "-" : (summary.jsHeapUsedBytes.median / 1e6).toFixed(1)} | ${summary.droppedFrames === null ? "-" : summary.droppedFrames.median.toFixed(0)} |`,
    );
  }
  return lines.join("\n");
}

export interface FailedCombo {
  readonly scenario: string;
  readonly surface: Surface;
  readonly size: FixtureSize;
  readonly error: string;
}

/**
 * Writes (or rewrites) the results files. Callers pass a stable stamp and
 * call this after every scenario, so a crash mid-suite loses at most the
 * scenario in flight.
 */
export async function writeResults(
  results: ReadonlyArray<ScenarioResult>,
  options: RunnerOptions,
  stamp: string,
  failures: ReadonlyArray<FailedCombo> = [],
): Promise<{ jsonPath: string; markdownPath: string }> {
  await NodeFSP.mkdir(options.outDir, { recursive: true });
  const jsonPath = NodePath.join(options.outDir, `perf-${stamp}.json`);
  const markdownPath = NodePath.join(options.outDir, `perf-${stamp}.md`);
  await NodeFSP.writeFile(jsonPath, JSON.stringify({ results, failures }, null, 2));
  await NodeFSP.writeFile(markdownPath, renderMarkdown(results) + "\n");
  return { jsonPath, markdownPath };
}

export function newResultStamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}
