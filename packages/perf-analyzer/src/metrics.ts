// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side metric collection for the perf harness; runs outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import type { CDPSession, Page } from "playwright-core";

import * as NodeFSP from "node:fs/promises";

import { GpuSampler, type GpuBackendKind } from "./gpu.ts";
import type { LaunchedEnv } from "./launch.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/**
 * One measurement window around a scenario run. Numbers come from three
 * independent, per-app-isolated sources:
 * - CDP Performance.getMetrics diffs (renderer: script/layout/task time,
 *   heap, DOM and layout counts - counts are deterministic and the best
 *   regression signal),
 * - Electron app.getAppMetrics diffs (per-process CPU and memory including
 *   the GPU helper; desktop only),
 * - the ioreg GPU sampler (true GPU busy time per pid on Apple Silicon).
 */

export interface RendererMetrics {
  readonly scriptDurationMs: number;
  readonly layoutDurationMs: number;
  readonly recalcStyleDurationMs: number;
  readonly taskDurationMs: number;
  readonly jsHeapUsedBytes: number;
  readonly nodes: number;
  readonly layoutCount: number;
  readonly recalcStyleCount: number;
  readonly droppedFrames: number | null;
}

export interface ProcessMetrics {
  readonly pid: number;
  readonly type: string;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
}

export interface WindowMetrics {
  readonly wallMs: number;
  readonly renderer: RendererMetrics | null;
  /** GPU busy ms attributed to the app's GPU helper over the window. */
  readonly appGpuMs: number;
  /** GPU ms per wall second, the utilization-style number. */
  readonly appGpuMsPerSecond: number;
  /** WindowServer GPU ms over the window (compositing done on our behalf plus everyone else's). */
  readonly windowServerGpuMs: number;
  readonly deviceGpuUtilizationMean: number | null;
  /** Which mechanism produced appGpuMs; "none" means no GPU attribution here. */
  readonly gpuBackend: GpuBackendKind;
  /**
   * CPU ms burned by the app's GPU process over the window (Linux only).
   * Under software rendering this is where "GPU cost" actually lands, so it
   * is the honest number on machines where gpuBackend is "none".
   */
  readonly gpuProcessCpuMs: number | null;
  /** Desktop only: per-Electron-process CPU/memory. */
  readonly processes: ReadonlyArray<ProcessMetrics> | null;
  /** Web only: server process RSS at window end. */
  readonly serverRssBytes: number | null;
  /** performance.measure entries created in the page during the window. */
  readonly pageMeasures: ReadonlyArray<{ readonly name: string; readonly durationMs: number }>;
}

type MetricTable = ReadonlyMap<string, number>;

async function cdpMetrics(session: CDPSession): Promise<MetricTable> {
  const { metrics } = (await session.send("Performance.getMetrics")) as {
    metrics: Array<{ name: string; value: number }>;
  };
  return new Map(metrics.map((metric) => [metric.name, metric.value]));
}

function diffSeconds(before: MetricTable, after: MetricTable, name: string): number {
  return Math.max(0, ((after.get(name) ?? 0) - (before.get(name) ?? 0)) * 1000);
}

async function rssBytes(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFile("ps", ["-o", "rss=", "-p", String(pid)]);
    const kb = Number(stdout.trim());
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

async function windowServerPid(): Promise<number | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFile("pgrep", ["-x", "WindowServer"]);
    const pid = Number(stdout.trim().split("\n")[0]);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

let clockTicksPerSecond: number | null = null;

/** Cumulative CPU ms (user+system) for a pid from /proc; Linux only. */
async function procCpuMs(pid: number): Promise<number | null> {
  if (process.platform !== "linux") return null;
  try {
    if (clockTicksPerSecond === null) {
      const { stdout } = await execFile("getconf", ["CLK_TCK"]);
      const parsed = Number(stdout.trim());
      clockTicksPerSecond = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
    }
    const stat = await NodeFSP.readFile(`/proc/${pid}/stat`, "utf8");
    // Fields 14/15 (utime/stime) follow the parenthesized comm, which can
    // itself contain spaces; split after the closing paren.
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const utime = Number(afterComm[11]);
    const stime = Number(afterComm[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return ((utime + stime) / clockTicksPerSecond) * 1000;
  } catch {
    return null;
  }
}

export class MetricsWindow {
  readonly #env: LaunchedEnv;
  readonly #page: Page;
  readonly #session: CDPSession | null;
  readonly #before: MetricTable | null;
  readonly #gpuSampler: GpuSampler;
  readonly #pageT0: number;
  readonly #startedAtMs: number;
  readonly #gpuCpuBeforeMs: number | null;

  private constructor(
    env: LaunchedEnv,
    page: Page,
    session: CDPSession | null,
    before: MetricTable | null,
    gpuSampler: GpuSampler,
    pageT0: number,
    startedAtMs: number,
    gpuCpuBeforeMs: number | null,
  ) {
    this.#env = env;
    this.#page = page;
    this.#session = session;
    this.#before = before;
    this.#gpuSampler = gpuSampler;
    this.#pageT0 = pageT0;
    this.#startedAtMs = startedAtMs;
    this.#gpuCpuBeforeMs = gpuCpuBeforeMs;
  }

  static async start(env: LaunchedEnv, page: Page): Promise<MetricsWindow> {
    // CDP attach can be unavailable on Electron pages; renderer metrics are
    // then simply omitted rather than failing the run.
    let session: CDPSession | null = null;
    let before: MetricTable | null = null;
    try {
      session = await page.context().newCDPSession(page);
      await session.send("Performance.enable");
      before = await cdpMetrics(session);
    } catch {
      session = null;
    }
    if (env.electronApp !== null) {
      // Baseline call: percentCPUUsage measures since the previous call.
      await env.electronApp.evaluate(({ app }) => app.getAppMetrics());
    }
    const gpuSampler = new GpuSampler(2000, [env.gpuHelperPid]);
    await gpuSampler.start();
    const gpuCpuBeforeMs = await procCpuMs(env.gpuHelperPid);
    const pageT0 = await page.evaluate(() => performance.now()).catch(() => 0);
    return new MetricsWindow(
      env,
      page,
      session,
      before,
      gpuSampler,
      pageT0,
      Date.now(),
      gpuCpuBeforeMs,
    );
  }

  async end(): Promise<WindowMetrics> {
    const wallMs = Date.now() - this.#startedAtMs;
    const gpu = await this.#gpuSampler.stop();

    let renderer: RendererMetrics | null = null;
    if (this.#session !== null && this.#before !== null) {
      try {
        const after = await cdpMetrics(this.#session);
        const before = this.#before;
        const dropped = after.get("DroppedFrameCount");
        renderer = {
          scriptDurationMs: diffSeconds(before, after, "ScriptDuration"),
          layoutDurationMs: diffSeconds(before, after, "LayoutDuration"),
          recalcStyleDurationMs: diffSeconds(before, after, "RecalcStyleDuration"),
          taskDurationMs: diffSeconds(before, after, "TaskDuration"),
          jsHeapUsedBytes: after.get("JSHeapUsedSize") ?? 0,
          nodes: after.get("Nodes") ?? 0,
          layoutCount: (after.get("LayoutCount") ?? 0) - (before.get("LayoutCount") ?? 0),
          recalcStyleCount:
            (after.get("RecalcStyleCount") ?? 0) - (before.get("RecalcStyleCount") ?? 0),
          droppedFrames:
            dropped === undefined
              ? null
              : dropped - (before.get("DroppedFrameCount") ?? 0),
        };
        await this.#session.detach().catch(() => undefined);
      } catch {
        renderer = null;
      }
    }

    let processes: ReadonlyArray<ProcessMetrics> | null = null;
    if (this.#env.electronApp !== null) {
      const metrics = await this.#env.electronApp.evaluate(({ app }) => app.getAppMetrics());
      processes = metrics.map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        cpuPercent: metric.cpu.percentCPUUsage,
        memoryBytes: (metric.memory.workingSetSize ?? 0) * 1024,
      }));
    }

    const serverRssBytes =
      this.#env.serverPid !== null && this.#env.serverPid > 0
        ? await rssBytes(this.#env.serverPid)
        : null;

    const wsPid = await windowServerPid();
    const appGpuMs = gpu.gpuMsByPid.get(this.#env.gpuHelperPid) ?? 0;
    const gpuCpuAfterMs = await procCpuMs(this.#env.gpuHelperPid);
    const gpuProcessCpuMs =
      this.#gpuCpuBeforeMs !== null && gpuCpuAfterMs !== null
        ? Math.max(0, gpuCpuAfterMs - this.#gpuCpuBeforeMs)
        : null;
    const pageMeasures = await this.#page
      .evaluate(
        (t0) =>
          performance
            .getEntriesByType("measure")
            .filter((entry) => entry.startTime >= t0)
            .map((entry) => ({ name: entry.name, durationMs: entry.duration })),
        this.#pageT0,
      )
      .catch(() => [] as Array<{ name: string; durationMs: number }>);

    return {
      wallMs,
      renderer,
      appGpuMs,
      appGpuMsPerSecond: gpu.wallMs > 0 ? appGpuMs / (gpu.wallMs / 1000) : 0,
      windowServerGpuMs: wsPid === null ? 0 : (gpu.gpuMsByPid.get(wsPid) ?? 0),
      deviceGpuUtilizationMean: gpu.deviceUtilizationMean,
      gpuBackend: gpu.backend,
      gpuProcessCpuMs,
      processes,
      serverRssBytes,
      pageMeasures,
    };
  }
}
