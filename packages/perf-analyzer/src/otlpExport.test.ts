// @effect-diagnostics globalDate:off - Compares nowUnixNano against the real wall clock.
import { describe, expect, it } from "@effect/vitest";

import type { WindowMetrics } from "./metrics.ts";
import { buildOtlpPayload, nowUnixNano } from "./otlpExport.ts";
import type { ScenarioResult } from "./runner.ts";
import { summarize } from "./stats.ts";

function makeRun(wallMs: number, overrides: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    wallMs,
    renderer: {
      scriptDurationMs: wallMs / 10,
      layoutDurationMs: 5,
      recalcStyleDurationMs: 2,
      taskDurationMs: 20,
      jsHeapUsedBytes: 1_000_000,
      nodes: 100,
      layoutCount: 3,
      recalcStyleCount: 4,
      droppedFrames: 0,
    },
    appGpuMs: 50,
    appGpuMsPerSecond: 25,
    windowServerGpuMs: 0,
    deviceGpuUtilizationMean: null,
    gpuBackend: "agx",
    gpuProcessCpuMs: null,
    processes: null,
    serverRssBytes: null,
    pageMeasures: [],
    ...overrides,
  };
}

function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  const runs = [makeRun(100), makeRun(200), makeRun(400)];
  return {
    scenario: "startup",
    surface: "web",
    size: "small",
    runs,
    summary: {
      wallMs: summarize(runs.map((run) => run.wallMs)),
      appGpuMsPerSecond: summarize(runs.map((run) => run.appGpuMsPerSecond)),
      scriptDurationMs: null,
      layoutDurationMs: null,
      layoutCount: null,
      jsHeapUsedBytes: null,
      droppedFrames: null,
    },
    ...overrides,
  };
}

const META = { timeUnixNano: "1755763200000000000", host: "bench-host" } as const;

function metricsOf(results: ReadonlyArray<ScenarioResult>) {
  return buildOtlpPayload(results, META).resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? [];
}

function attrValue(
  point: { attributes: ReadonlyArray<{ key: string; value: { stringValue: string } }> },
  key: string,
): string | undefined {
  return point.attributes.find((attr) => attr.key === key)?.value.stringValue;
}

describe("buildOtlpPayload", () => {
  it("emits the full metric set with t3perf names", () => {
    const names = metricsOf([makeResult()]).map((metric) => metric.name);
    expect(names).toEqual([
      "t3perf.wall_ms",
      "t3perf.gpu_ms_per_s",
      "t3perf.script_ms",
      "t3perf.js_heap_bytes",
      "t3perf.layout_count",
      "t3perf.runs",
    ]);
  });

  it("computes median and p75 gauge datapoints from the raw runs", () => {
    const wall = metricsOf([makeResult()]).find((metric) => metric.name === "t3perf.wall_ms");
    expect(wall?.unit).toBe("ms");
    const points = wall?.gauge.dataPoints ?? [];
    expect(points).toHaveLength(2);
    const median = points.find((point) => attrValue(point, "stat") === "median");
    const p75 = points.find((point) => attrValue(point, "stat") === "p75");
    expect(median?.asDouble).toBe(200);
    // Linear interpolation over [100, 200, 400]: 200 + 0.5 * (400 - 200).
    expect(p75?.asDouble).toBe(300);
  });

  it("counts runs without a stat attribute", () => {
    const runsMetric = metricsOf([makeResult()]).find((metric) => metric.name === "t3perf.runs");
    const point = runsMetric?.gauge.dataPoints[0];
    expect(point?.asDouble).toBe(3);
    expect(attrValue(point!, "stat")).toBeUndefined();
  });

  it("propagates attributes and defaults label/build/network", () => {
    const point = metricsOf([makeResult()])[0]?.gauge.dataPoints[0];
    expect(attrValue(point!, "scenario")).toBe("startup");
    expect(attrValue(point!, "surface")).toBe("web");
    expect(attrValue(point!, "size")).toBe("small");
    expect(attrValue(point!, "label")).toBe("repo");
    // Results without a build fall back to the meta timestamp, minute resolution.
    expect(attrValue(point!, "build")).toBe("2025-08-21 08:00");
    expect(attrValue(point!, "network")).toBe("good");
    expect(attrValue(point!, "host")).toBe("bench-host");
    expect(attrValue(point!, "run")).toBe("standalone");
    expect(attrValue(point!, "gpu_backend")).toBe("agx");
  });

  it("carries explicit label, build, and network through", () => {
    const point = metricsOf([
      makeResult({
        label: "0.0.33",
        build: "0.0.33-nightly.20250820",
        network: "flaky",
        runId: "run-123",
      }),
    ])[0]?.gauge.dataPoints[0];
    expect(attrValue(point!, "label")).toBe("0.0.33");
    expect(attrValue(point!, "build")).toBe("0.0.33-nightly.20250820");
    expect(attrValue(point!, "network")).toBe("flaky");
    expect(attrValue(point!, "run")).toBe("run-123");
  });

  it("derives gpu_process_cpu_ms_per_s only when the runs measured it", () => {
    const without = metricsOf([makeResult()]);
    expect(without.some((metric) => metric.name === "t3perf.gpu_process_cpu_ms_per_s")).toBe(false);

    const runs = [
      makeRun(1000, { gpuProcessCpuMs: 100 }),
      makeRun(1000, { gpuProcessCpuMs: 200 }),
      makeRun(1000, { gpuProcessCpuMs: 300 }),
    ];
    const withCpu = metricsOf([makeResult({ runs })]);
    const metric = withCpu.find((entry) => entry.name === "t3perf.gpu_process_cpu_ms_per_s");
    const median = metric?.gauge.dataPoints.find((point) => attrValue(point, "stat") === "median");
    // 200 CPU ms over a 1s window is 200 ms/s.
    expect(median?.asDouble).toBe(200);
  });

  it("skips renderer metrics when no run captured a renderer", () => {
    const runs = [makeRun(100, { renderer: null })];
    const names = metricsOf([makeResult({ runs })]).map((metric) => metric.name);
    expect(names).toEqual(["t3perf.wall_ms", "t3perf.gpu_ms_per_s", "t3perf.runs"]);
  });

  it("stamps every datapoint with the meta timestamp", () => {
    for (const metric of metricsOf([makeResult()])) {
      for (const point of metric.gauge.dataPoints) {
        expect(point.timeUnixNano).toBe(META.timeUnixNano);
      }
    }
  });

  it("honors per-result timestamps and derives the build fallback from them", () => {
    // 2025-08-20T00:00:00Z, one day before the meta timestamp.
    const historic = "1755648000000000000";
    const payload = buildOtlpPayload([makeResult(), makeResult()], META, [historic, undefined]);
    const wall = payload.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0];
    const [first, , third] = wall?.gauge.dataPoints ?? [];
    expect(first?.timeUnixNano).toBe(historic);
    expect(attrValue(first!, "build")).toBe("2025-08-20 00:00");
    expect(third?.timeUnixNano).toBe(META.timeUnixNano);
    expect(attrValue(third!, "build")).toBe("2025-08-21 08:00");
  });
});

describe("nowUnixNano", () => {
  it("returns integer nanoseconds consistent with wall-clock milliseconds", () => {
    const nano = nowUnixNano();
    expect(nano).toMatch(/^\d{19}$/);
    expect(nano.endsWith("000000")).toBe(true);
    const asMs = Number(nano.slice(0, -6));
    expect(Math.abs(asMs - Date.now())).toBeLessThan(5_000);
  });
});
