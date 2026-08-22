// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off preferSchemaOverJson:off - Host-side bench recorder; writes perf-analyzer results JSON outside the Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/**
 * Records server-side benchmark measurements and writes them in the exact
 * results JSON shape the perf-analyzer runner emits, so report.ts and
 * otlpBackfill.ts in packages/perf-analyzer ingest vitest benches like any
 * Playwright scenario run. The types below deliberately mirror
 * packages/perf-analyzer/src/runner.ts (ScenarioResult), src/metrics.ts
 * (WindowMetrics) and src/stats.ts (SampleSummary); keep them in sync.
 *
 * Output path: T3CODE_PERF_BENCH_OUT when set, otherwise
 * packages/perf-analyzer/results-server/perf-<stamp>.json.
 */

export type BenchFixtureSize = "small" | "medium" | "large";

export interface BenchSampleSummary {
  readonly n: number;
  readonly median: number;
  readonly mean: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
  readonly ci95: readonly [number, number];
}

/** WindowMetrics with everything a headless server bench cannot measure nulled or zeroed. */
export interface BenchRunMetrics {
  readonly wallMs: number;
  readonly renderer: null;
  readonly appGpuMs: number;
  readonly appGpuMsPerSecond: number;
  readonly windowServerGpuMs: number;
  readonly deviceGpuUtilizationMean: null;
  readonly gpuBackend: "none";
  readonly gpuProcessCpuMs: null;
  readonly processes: null;
  readonly serverRssBytes: number | null;
  readonly pageMeasures: ReadonlyArray<never>;
}

export interface BenchScenarioResult {
  readonly scenario: string;
  readonly surface: "server";
  readonly size: BenchFixtureSize;
  readonly label?: string;
  readonly runs: ReadonlyArray<BenchRunMetrics>;
  readonly summary: {
    readonly wallMs: BenchSampleSummary;
    readonly appGpuMsPerSecond: BenchSampleSummary;
    readonly scriptDurationMs: null;
    readonly layoutDurationMs: null;
    readonly layoutCount: null;
    readonly jsHeapUsedBytes: null;
    readonly droppedFrames: null;
  };
}

export interface BenchMeasurementSummary {
  readonly scenario: string;
  readonly size: BenchFixtureSize;
  readonly n: number;
  readonly p50Ms: number;
  readonly p75Ms: number;
  readonly p95Ms: number;
}

// Two-tailed 95% t critical values by degrees of freedom (1..30), then z.
// Mirrors packages/perf-analyzer/src/stats.ts so intervals agree across
// server and client results.
const T_TABLE = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16,
  2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052,
  2.048, 2.045, 2.042,
] as const;

function tCritical(degreesOfFreedom: number): number {
  if (degreesOfFreedom < 1) return Number.NaN;
  return T_TABLE[Math.min(degreesOfFreedom, T_TABLE.length) - 1] ?? 1.96;
}

export function summarizeSamples(samples: ReadonlyArray<number>): BenchSampleSummary {
  if (samples.length === 0) throw new Error("Cannot summarize zero samples.");
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const mid = Math.floor(n / 2);
  const lower = sorted[mid - 1] ?? mean;
  const upper = sorted[mid] ?? mean;
  const median = n % 2 === 1 ? upper : (lower + upper) / 2;
  if (n === 1) {
    return { n, median, mean, stddev: 0, min: mean, max: mean, ci95: [mean, mean] };
  }
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  const margin = tCritical(n - 1) * (stddev / Math.sqrt(n));
  return {
    n,
    median,
    mean,
    stddev,
    min: sorted[0] ?? mean,
    max: sorted[n - 1] ?? mean,
    ci95: [mean - margin, mean + margin],
  };
}

/** Linear-interpolated quantile over unsorted samples; q in [0, 1]. */
export function quantileMs(samples: ReadonlyArray<number>, q: number): number {
  if (samples.length === 0) throw new Error("Cannot take a quantile of zero samples.");
  const sorted = [...samples].sort((a, b) => a - b);
  const position = q * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[lowerIndex + 1] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function defaultOutPath(): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return NodePath.join(repoRoot, "packages", "perf-analyzer", "results-server", `perf-${stamp}.json`);
}

function toResult(input: {
  readonly scenario: string;
  readonly size: BenchFixtureSize;
  readonly samplesMs: ReadonlyArray<number>;
  readonly label?: string | undefined;
}): BenchScenarioResult {
  const rss = process.memoryUsage().rss;
  const runs = input.samplesMs.map(
    (wallMs): BenchRunMetrics => ({
      wallMs,
      renderer: null,
      appGpuMs: 0,
      appGpuMsPerSecond: 0,
      windowServerGpuMs: 0,
      deviceGpuUtilizationMean: null,
      gpuBackend: "none",
      gpuProcessCpuMs: null,
      processes: null,
      serverRssBytes: rss,
      pageMeasures: [],
    }),
  );
  return {
    scenario: input.scenario,
    surface: "server",
    size: input.size,
    ...(input.label !== undefined ? { label: input.label } : {}),
    runs,
    summary: {
      wallMs: summarizeSamples(input.samplesMs),
      appGpuMsPerSecond: summarizeSamples(runs.map(() => 0)),
      scriptDurationMs: null,
      layoutDurationMs: null,
      layoutCount: null,
      jsHeapUsedBytes: null,
      droppedFrames: null,
    },
  };
}

export interface PerfBenchRecorder {
  /** Runs `run` warmup + runs times and records one wallMs sample per measured run. */
  readonly measure: (input: {
    readonly scenario: string;
    readonly size: BenchFixtureSize;
    readonly runs: number;
    /** Discarded runs before measurement starts; defaults to 2. */
    readonly warmup?: number;
    readonly run: () => Promise<unknown>;
  }) => Promise<BenchMeasurementSummary>;
  /** Records already-collected samples (for measurements timed by the caller). */
  readonly record: (input: {
    readonly scenario: string;
    readonly size: BenchFixtureSize;
    readonly samplesMs: ReadonlyArray<number>;
  }) => BenchMeasurementSummary;
  /** Writes every recorded measurement as one results JSON file; returns its path. */
  readonly flush: () => Promise<string>;
}

export function makePerfBenchRecorder(options?: {
  readonly label?: string;
}): PerfBenchRecorder {
  const results: Array<BenchScenarioResult> = [];

  const record: PerfBenchRecorder["record"] = (input) => {
    results.push(
      toResult({
        scenario: input.scenario,
        size: input.size,
        samplesMs: input.samplesMs,
        label: options?.label,
      }),
    );
    const summary: BenchMeasurementSummary = {
      scenario: input.scenario,
      size: input.size,
      n: input.samplesMs.length,
      p50Ms: quantileMs(input.samplesMs, 0.5),
      p75Ms: quantileMs(input.samplesMs, 0.75),
      p95Ms: quantileMs(input.samplesMs, 0.95),
    };
    console.log(
      `[perf-bench] ${summary.scenario} (${summary.size}): p50 ${summary.p50Ms.toFixed(2)}ms, p95 ${summary.p95Ms.toFixed(2)}ms over ${summary.n} runs`,
    );
    return summary;
  };

  const measure: PerfBenchRecorder["measure"] = async (input) => {
    const warmup = input.warmup ?? 2;
    for (let i = 0; i < warmup; i++) await input.run();
    const samples: Array<number> = [];
    for (let i = 0; i < input.runs; i++) {
      const startedAt = performance.now();
      await input.run();
      samples.push(performance.now() - startedAt);
    }
    return record({ scenario: input.scenario, size: input.size, samplesMs: samples });
  };

  const flush: PerfBenchRecorder["flush"] = async () => {
    const outPath = process.env["T3CODE_PERF_BENCH_OUT"] ?? defaultOutPath();
    await NodeFSP.mkdir(NodePath.dirname(outPath), { recursive: true });
    await NodeFSP.writeFile(outPath, JSON.stringify({ results, failures: [] }, null, 2));
    console.log(`[perf-bench] wrote ${results.length} result(s) to ${outPath}`);
    return outPath;
  };

  return { measure, record, flush };
}
