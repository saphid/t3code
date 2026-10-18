// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side GPU sampler that shells out to macOS ioreg; runs outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/**
 * Per-process GPU attribution on Apple Silicon, without sudo.
 *
 * Every Metal command queue a process creates shows up in the IORegistry as an
 * AGXDeviceUserClient entry whose AppUsage carries accumulatedGPUTime in
 * nanoseconds and whose IOUserClientCreator names the owning pid. Because all
 * of a Chromium/Electron app's GPU work funnels through its single
 * `--type=gpu-process` helper, delta-sampling these counters for that one pid
 * measures the app's GPU time exactly, unaffected by anything else running on
 * the machine. Compositing that WindowServer performs on the app's behalf
 * lands in WindowServer's bucket; that is true of every per-process method on
 * macOS, including Activity Monitor.
 */

interface AgxEntry {
  readonly entryId: number;
  readonly pid: number;
  readonly gpuTimeNs: number;
}

interface GpuSnapshot {
  readonly entries: ReadonlyMap<number, AgxEntry>;
}

/** Parses the JSON form of `ioreg -c AGXDeviceUserClient -d 1 -r -a`. */
export function parseAgxEntries(raw: unknown): GpuSnapshot {
  if (!Array.isArray(raw)) throw new Error("ioreg AGXDeviceUserClient output is not an array.");
  const entries = new Map<number, AgxEntry>();
  let sawAppUsage = false;
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const creator = record["IOUserClientCreator"];
    const entryId = record["IORegistryEntryID"];
    const appUsage = record["AppUsage"];
    if (typeof creator !== "string" || typeof entryId !== "number") continue;
    if (!Array.isArray(appUsage)) continue;
    sawAppUsage = true;
    const pidMatch = /^pid (\d+),/.exec(creator);
    if (!pidMatch?.[1]) continue;
    let gpuTimeNs = 0;
    for (const usage of appUsage) {
      const time = (usage as Record<string, unknown>)["accumulatedGPUTime"];
      if (typeof time === "number") gpuTimeNs += time;
    }
    entries.set(entryId, { entryId, pid: Number(pidMatch[1]), gpuTimeNs });
  }
  if (raw.length > 0 && !sawAppUsage) {
    throw new Error(
      "ioreg AGXDeviceUserClient entries carry no AppUsage; the macOS GPU registry layout has changed and this sampler needs updating.",
    );
  }
  return { entries };
}

async function ioregJson(ioClass: string): Promise<unknown> {
  const { stdout } = await execFile("/bin/sh", [
    "-c",
    `ioreg -c ${ioClass} -d 1 -r -a | plutil -convert json -o - -`,
  ]);
  return JSON.parse(stdout);
}

export async function snapshotGpu(): Promise<GpuSnapshot> {
  return parseAgxEntries(await ioregJson("AGXDeviceUserClient"));
}

/**
 * GPU nanoseconds spent per pid between two snapshots. Command queues are
 * matched by IORegistryEntryID; queues created inside the window contribute
 * their full accumulated time, queues destroyed inside it are lost (a small
 * undercount, bounded by the sampler interval).
 */
export function diffGpu(before: GpuSnapshot, after: GpuSnapshot): Map<number, number> {
  const byPid = new Map<number, number>();
  for (const entry of after.entries.values()) {
    const prior = before.entries.get(entry.entryId);
    const priorNs = prior !== undefined && prior.pid === entry.pid ? prior.gpuTimeNs : 0;
    const delta = Math.max(0, entry.gpuTimeNs - priorNs);
    if (delta === 0) continue;
    byPid.set(entry.pid, (byPid.get(entry.pid) ?? 0) + delta);
  }
  return byPid;
}

/**
 * Whole-device GPU utilization percentage, used as an ambient-noise guard.
 * Parsed from ioreg's text form: the IOAccelerator plist embeds binary blobs
 * that plutil's JSON conversion rejects.
 */
export async function deviceGpuUtilization(): Promise<number | null> {
  try {
    const { stdout } = await execFile("/usr/sbin/ioreg", ["-c", "IOAccelerator", "-d", "1", "-r"]);
    const match = /"Device Utilization %"=(\d+)/.exec(stdout);
    return match?.[1] !== undefined ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Which mechanism produced the per-process GPU numbers:
 * - agx: macOS IORegistry AGX counters (true GPU busy ns).
 * - drm-fdinfo: Linux /proc/<pid>/fdinfo drm-engine-* counters (true GPU busy
 *   ns; AMD, Intel, and NVIDIA open drivers).
 * - nvidia-smi: NVIDIA proprietary driver, per-process SM utilization sampled
 *   over the window (an estimate, not exact busy time).
 * - none: no GPU attribution available on this machine (headless/software
 *   rendering; the GPU process's CPU time is the meaningful cost there and is
 *   reported separately by the metrics collector).
 */
export type GpuBackendKind = "agx" | "drm-fdinfo" | "nvidia-smi" | "none";

export interface GpuWindowResult {
  /** GPU busy milliseconds attributed to each pid over the window. */
  readonly gpuMsByPid: ReadonlyMap<number, number>;
  readonly wallMs: number;
  /** Mean whole-device utilization over the window, for noise context. */
  readonly deviceUtilizationMean: number | null;
  readonly backend: GpuBackendKind;
}

/** Sums drm-engine-* nanoseconds from one fdinfo file's text, or null. */
export function parseDrmEngineNs(text: string): { clientId: string | null; ns: number } | null {
  if (!text.includes("drm-engine-")) return null;
  const clientId = /drm-client-id:\s*(\d+)/.exec(text)?.[1] ?? null;
  let ns = 0;
  for (const match of text.matchAll(/drm-engine-[a-z0-9_-]+:\s*(\d+)\s*ns/g)) {
    ns += Number(match[1]);
  }
  return { clientId, ns };
}

/**
 * Cumulative GPU ns for a pid from DRM fdinfo. Multiple fds can point at the
 * same DRM client (dup'ed fds share counters), so totals are deduplicated by
 * drm-client-id. Returns null when the pid exposes no DRM engine counters.
 */
async function drmGpuNsForPid(pid: number): Promise<number | null> {
  const NodeFSP = await import("node:fs/promises");
  const dir = `/proc/${pid}/fdinfo`;
  let entries: Array<string>;
  try {
    entries = await NodeFSP.readdir(dir);
  } catch {
    return null;
  }
  const byClient = new Map<string, number>();
  for (const entry of entries) {
    const text = await NodeFSP.readFile(`${dir}/${entry}`, "utf8").catch(() => null);
    if (text === null) continue;
    const parsed = parseDrmEngineNs(text);
    if (parsed === null) continue;
    byClient.set(parsed.clientId ?? `fd-${entry}`, parsed.ns);
  }
  if (byClient.size === 0) return null;
  let total = 0;
  for (const ns of byClient.values()) total += ns;
  return total;
}

let nvidiaSmiAvailable: boolean | null = null;

/** Per-pid SM utilization percent from one nvidia-smi pmon sample. */
async function nvidiaSmUtilization(): Promise<Map<number, number> | null> {
  if (nvidiaSmiAvailable === false) return null;
  try {
    const { stdout } = await execFile("nvidia-smi", ["pmon", "-c", "1", "-s", "u"]);
    nvidiaSmiAvailable = true;
    const byPid = new Map<number, number>();
    for (const line of stdout.split("\n")) {
      if (line.startsWith("#")) continue;
      const fields = line.trim().split(/\s+/);
      const pid = Number(fields[1]);
      const sm = Number(fields[3]);
      if (Number.isFinite(pid) && Number.isFinite(sm)) byPid.set(pid, sm);
    }
    return byPid;
  } catch {
    nvidiaSmiAvailable = false;
    return null;
  }
}

/** True where full-machine GPU attribution needs no target pids (macOS). */
export const gpuSamplingAvailable = process.platform === "darwin";

/**
 * Accumulates per-pid GPU time over a measurement window. Samples periodically
 * rather than only at the edges so command queues that die mid-scenario lose
 * at most one interval of attribution. On macOS every pid on the machine is
 * covered; on Linux only the target pids passed to the constructor are.
 */
export class GpuSampler {
  #intervalMs: number;
  #targetPids: ReadonlyArray<number>;
  #timer: NodeJS.Timeout | null = null;
  #last: GpuSnapshot | null = null;
  #lastLinuxNs = new Map<number, number>();
  #lastSampleAt = 0;
  #totals = new Map<number, number>();
  #deviceUtilSamples: Array<number> = [];
  #startedAt = 0;
  #pending: Promise<void> = Promise.resolve();
  #backend: GpuBackendKind = "none";

  constructor(intervalMs = 2000, targetPids: ReadonlyArray<number> = []) {
    this.#intervalMs = intervalMs;
    this.#targetPids = targetPids;
  }

  async start(): Promise<void> {
    this.#startedAt = Date.now();
    this.#lastSampleAt = this.#startedAt;
    if (process.platform === "darwin") {
      this.#backend = "agx";
      this.#last = await snapshotGpu();
    } else if (process.platform === "linux") {
      for (const pid of this.#targetPids) {
        const ns = await drmGpuNsForPid(pid);
        if (ns !== null) this.#lastLinuxNs.set(pid, ns);
      }
    } else {
      return;
    }
    this.#timer = setInterval(() => {
      this.#pending = this.#pending.then(() => this.#accumulate());
    }, this.#intervalMs);
    this.#timer.unref();
  }

  async #accumulate(): Promise<void> {
    if (process.platform === "darwin") return this.#accumulateDarwin();
    if (process.platform === "linux") return this.#accumulateLinux();
  }

  async #accumulateDarwin(): Promise<void> {
    if (this.#last === null) return;
    const [next, deviceUtil] = await Promise.all([snapshotGpu(), deviceGpuUtilization()]);
    for (const [pid, ns] of diffGpu(this.#last, next)) {
      this.#totals.set(pid, (this.#totals.get(pid) ?? 0) + ns);
    }
    if (deviceUtil !== null) this.#deviceUtilSamples.push(deviceUtil);
    this.#last = next;
  }

  async #accumulateLinux(): Promise<void> {
    const now = Date.now();
    const elapsedMs = now - this.#lastSampleAt;
    this.#lastSampleAt = now;
    let sawDrm = false;
    for (const pid of this.#targetPids) {
      const ns = await drmGpuNsForPid(pid);
      if (ns === null) continue;
      sawDrm = true;
      const prior = this.#lastLinuxNs.get(pid) ?? 0;
      this.#totals.set(pid, (this.#totals.get(pid) ?? 0) + Math.max(0, ns - prior));
      this.#lastLinuxNs.set(pid, ns);
    }
    if (sawDrm) {
      this.#backend = "drm-fdinfo";
      return;
    }
    if (this.#backend === "drm-fdinfo") return; // fdinfo worked before; a quiet sample is not a reason to switch.
    const sm = await nvidiaSmUtilization();
    if (sm === null) return;
    for (const pid of this.#targetPids) {
      const percent = sm.get(pid);
      if (percent === undefined) continue;
      this.#backend = "nvidia-smi";
      // Convert utilization over the elapsed slice into GPU-ms, stored as ns
      // so stop() can share the one division.
      this.#totals.set(
        pid,
        (this.#totals.get(pid) ?? 0) + (percent / 100) * elapsedMs * 1e6,
      );
    }
  }

  async stop(): Promise<GpuWindowResult> {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.#pending;
    await this.#accumulate();
    this.#last = null;
    const gpuMsByPid = new Map<number, number>();
    for (const [pid, ns] of this.#totals) gpuMsByPid.set(pid, ns / 1e6);
    const utilSamples = this.#deviceUtilSamples;
    return {
      gpuMsByPid,
      wallMs: Date.now() - this.#startedAt,
      deviceUtilizationMean:
        utilSamples.length === 0
          ? null
          : utilSamples.reduce((sum, value) => sum + value, 0) / utilSamples.length,
      backend: this.#backend,
    };
  }
}

/**
 * Finds the `--type=gpu-process` helper in the process tree under a launched
 * Chromium or Electron root pid. Read-only: this never signals anything.
 */
export async function findGpuHelperPid(rootPid: number): Promise<number | null> {
  const { stdout } = await execFile("ps", ["-axo", "pid=,ppid=,command="]);
  const children = new Map<number, Array<number>>();
  const commands = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    commands.set(pid, match[3] ?? "");
    const siblings = children.get(ppid);
    if (siblings === undefined) children.set(ppid, [pid]);
    else siblings.push(pid);
  }
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined) break;
    if (pid !== rootPid && (commands.get(pid) ?? "").includes("--type=gpu-process")) return pid;
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return null;
}

/** Polls until the app under test has spawned its GPU helper. */
export async function waitForGpuHelperPid(rootPid: number, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = await findGpuHelperPid(rootPid);
    if (pid !== null) return pid;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No --type=gpu-process helper appeared under pid ${rootPid} within ${timeoutMs}ms.`);
}
