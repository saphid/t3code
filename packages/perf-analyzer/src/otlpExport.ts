// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off globalFetch:off - Host-side OTLP export for the perf harness; runs outside the Effect runtime.
import * as NodeOS from "node:os";

import type { ScenarioResult } from "./runner.ts";
import type { WindowMetrics } from "./metrics.ts";

/**
 * Zero-dependency OTLP/HTTP JSON export of scenario results, so a perf run
 * can feed an OpenTelemetry collector (and from there Prometheus/Grafana).
 * Every metric is a gauge: perf runs are point-in-time observations, not a
 * continuous instrument. Median and p75 are computed from the raw runs and
 * distinguished by a `stat` datapoint attribute.
 */

export interface OtlpMeta {
  /** Nanoseconds since the Unix epoch, as a decimal string (OTLP JSON int64). */
  readonly timeUnixNano: string;
  /** Hostname recorded as the `host` attribute on every datapoint. */
  readonly host: string;
}

interface OtlpKeyValue {
  readonly key: string;
  readonly value: { readonly stringValue: string };
}

interface OtlpDataPoint {
  readonly attributes: ReadonlyArray<OtlpKeyValue>;
  readonly timeUnixNano: string;
  readonly asDouble: number;
}

interface OtlpMetric {
  readonly name: string;
  readonly unit: string;
  readonly gauge: { readonly dataPoints: ReadonlyArray<OtlpDataPoint> };
}

/** ExportMetricsServiceRequest in the OTLP JSON encoding. */
export interface OtlpPayload {
  readonly resourceMetrics: ReadonlyArray<{
    readonly resource: { readonly attributes: ReadonlyArray<OtlpKeyValue> };
    readonly scopeMetrics: ReadonlyArray<{
      readonly scope: { readonly name: string };
      readonly metrics: ReadonlyArray<OtlpMetric>;
    }>;
  }>;
}

/** Linear-interpolated quantile; matches stats.summarize's median for q=0.5. */
function quantile(sorted: ReadonlyArray<number>, q: number): number {
  const position = q * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[lowerIndex + 1] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

const SAMPLED_METRICS: ReadonlyArray<{
  readonly name: string;
  readonly unit: string;
  readonly sample: (run: WindowMetrics) => number | null;
}> = [
  { name: "t3perf.wall_ms", unit: "ms", sample: (run) => run.wallMs },
  { name: "t3perf.gpu_ms_per_s", unit: "ms/s", sample: (run) => run.appGpuMsPerSecond },
  {
    name: "t3perf.gpu_process_cpu_ms_per_s",
    unit: "ms/s",
    sample: (run) =>
      run.gpuProcessCpuMs !== null && run.wallMs > 0
        ? run.gpuProcessCpuMs / (run.wallMs / 1000)
        : null,
  },
  { name: "t3perf.script_ms", unit: "ms", sample: (run) => run.renderer?.scriptDurationMs ?? null },
  {
    name: "t3perf.js_heap_bytes",
    unit: "By",
    sample: (run) => run.renderer?.jsHeapUsedBytes ?? null,
  },
  { name: "t3perf.layout_count", unit: "1", sample: (run) => run.renderer?.layoutCount ?? null },
];

function attribute(key: string, value: string): OtlpKeyValue {
  return { key, value: { stringValue: value } };
}

function resultAttributes(
  result: ScenarioResult,
  meta: OtlpMeta,
  timeUnixNano: string,
): ReadonlyArray<OtlpKeyValue> {
  // Results written before the build field existed fall back to the result's
  // timestamp (minute resolution, matching the CLI default), which equals the
  // run time on the normal run-then-export path.
  const fallbackBuild = new Date(Number(timeUnixNano.slice(0, -6)))
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  return [
    attribute("scenario", result.scenario),
    attribute("surface", result.surface),
    attribute("size", result.size),
    attribute("label", result.label ?? "repo"),
    attribute("build", result.build ?? fallbackBuild),
    attribute("network", result.network ?? "good"),
    attribute("host", meta.host),
    attribute("gpu_backend", result.runs[0]?.gpuBackend ?? "none"),
  ];
}

export function buildOtlpPayload(
  results: ReadonlyArray<ScenarioResult>,
  meta: OtlpMeta,
  // Per-result timestamps (parallel to results). The backfill passes each
  // file's run time so history lands where it happened; live exports omit it.
  timestamps?: ReadonlyArray<string | undefined>,
): OtlpPayload {
  const dataPointsByMetric = new Map<string, { unit: string; dataPoints: Array<OtlpDataPoint> }>();
  const push = (name: string, unit: string, point: OtlpDataPoint) => {
    const existing = dataPointsByMetric.get(name);
    if (existing !== undefined) existing.dataPoints.push(point);
    else dataPointsByMetric.set(name, { unit, dataPoints: [point] });
  };

  for (const [index, result] of results.entries()) {
    const timeUnixNano = timestamps?.[index] ?? meta.timeUnixNano;
    const base = resultAttributes(result, meta, timeUnixNano);
    for (const spec of SAMPLED_METRICS) {
      const samples = result.runs
        .map(spec.sample)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      if (samples.length === 0) continue;
      for (const [stat, value] of [
        ["median", quantile(samples, 0.5)],
        ["p75", quantile(samples, 0.75)],
      ] as const) {
        push(spec.name, spec.unit, {
          attributes: [...base, attribute("stat", stat)],
          timeUnixNano,
          asDouble: value,
        });
      }
    }
    push("t3perf.runs", "1", {
      attributes: base,
      timeUnixNano,
      asDouble: result.runs.length,
    });
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: [attribute("service.name", "t3-perf-analyzer")] },
        scopeMetrics: [
          {
            scope: { name: "t3perf" },
            metrics: [...dataPointsByMetric.entries()].map(([name, entry]) => ({
              name,
              unit: entry.unit,
              gauge: { dataPoints: entry.dataPoints },
            })),
          },
        ],
      },
    ],
  };
}

export function nowUnixNano(): string {
  return `${Date.now()}000000`;
}

export interface OtlpExportResult {
  readonly ok: boolean;
  /** HTTP status of the collector's response; 0 when the request never landed. */
  readonly status: number;
  /** Number of metric streams in the payload (datapoints grouped by name). */
  readonly metricCount: number;
  readonly error?: string;
}

/**
 * POSTs the results to `<endpointBaseUrl>/v1/metrics`. Never throws: a perf
 * run's numbers are already on disk, and a down collector must not turn a
 * completed benchmark into a failure.
 */
export async function exportOtlp(
  results: ReadonlyArray<ScenarioResult>,
  endpointBaseUrl: string,
  timestamps?: ReadonlyArray<string | undefined>,
): Promise<OtlpExportResult> {
  const payload = buildOtlpPayload(
    results,
    { timeUnixNano: nowUnixNano(), host: NodeOS.hostname() },
    timestamps,
  );
  const metricCount = payload.resourceMetrics[0]?.scopeMetrics[0]?.metrics.length ?? 0;
  const url = `${endpointBaseUrl.replace(/\/+$/, "")}/v1/metrics`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(`OTLP export to ${url} rejected: HTTP ${response.status}`);
      return { ok: false, status: response.status, metricCount, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, metricCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`OTLP export to ${url} failed: ${message}`);
    return { ok: false, status: 0, metricCount, error: message };
  }
}
