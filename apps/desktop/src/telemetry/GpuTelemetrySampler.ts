// @effect-diagnostics nodeBuiltinImport:off - Host-side GPU sampler; reads the macOS IORegistry and Linux procfs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeUtil from "node:util";

import type { DesktopGpuBackend } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

/**
 * Per-process GPU attribution, without sudo and without native modules.
 *
 * On Apple Silicon every Metal command queue a process owns appears in the
 * IORegistry as an AGXDeviceUserClient entry whose AppUsage carries
 * accumulatedGPUTime in nanoseconds and whose IOUserClientCreator names the
 * owning pid. Delta-sampling those counters between telemetry ticks yields GPU
 * busy time per pid. On Linux the equivalent counters are the drm-engine-*
 * lines in /proc/<pid>/fdinfo (AMD, Intel, and NVIDIA open drivers). Both are
 * cumulative, so a sample is only meaningful relative to the previous one.
 */

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/** A delta window larger than this is stale (demand was off); re-baseline instead. */
const MAX_WINDOW_MS = 30_000;
/** Repeated read failures disable the sampler so a broken host is not probed forever. */
const MAX_CONSECUTIVE_FAILURES = 3;

export interface GpuSample {
  readonly backend: DesktopGpuBackend;
  readonly gpuPercentByPid: ReadonlyMap<number, number>;
  readonly deviceUtilizationPercent: number | undefined;
}

export class GpuTelemetrySampler extends Context.Service<
  GpuTelemetrySampler,
  {
    /**
     * One delta sample of GPU busy percent per pid since the previous call.
     * `pids` scopes the Linux procfs walk; macOS attribution is machine-wide
     * and filtered to `pids`. Returns none until a baseline exists, when the
     * platform has no attribution source, or after the sampler disables itself.
     */
    readonly sample: (pids: ReadonlyArray<number>) => Effect.Effect<Option.Option<GpuSample>>;
  }
>()("@t3tools/desktop/telemetry/GpuTelemetrySampler") {}

class GpuReadFailed extends Schema.TaggedErrorClass<GpuReadFailed>()("GpuReadFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `GPU telemetry read failed: ${String(this.cause)}`;
  }
}

export interface AgxEntry {
  readonly entryId: number;
  readonly pid: number;
  readonly gpuTimeNs: number;
}

export interface AgxSnapshot {
  readonly entries: ReadonlyMap<number, AgxEntry>;
  readonly sawAppUsage: boolean;
}

/** Parses the JSON form of `ioreg -c AGXDeviceUserClient -d 1 -r -a`. */
export function parseAgxEntries(raw: unknown): AgxSnapshot {
  if (!Array.isArray(raw)) return { entries: new Map(), sawAppUsage: false };
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
  return { entries, sawAppUsage };
}

/**
 * GPU nanoseconds per pid between two AGX snapshots. Command queues are
 * matched by IORegistryEntryID; queues created inside the window contribute
 * their full accumulated time, queues destroyed inside it are lost (a small
 * undercount, bounded by the sample interval).
 */
export function diffAgxGpuNsByPid(
  before: ReadonlyMap<number, AgxEntry>,
  after: ReadonlyMap<number, AgxEntry>,
): Map<number, number> {
  const byPid = new Map<number, number>();
  for (const entry of after.values()) {
    const prior = before.get(entry.entryId);
    const priorNs = prior !== undefined && prior.pid === entry.pid ? prior.gpuTimeNs : 0;
    const delta = Math.max(0, entry.gpuTimeNs - priorNs);
    if (delta === 0) continue;
    byPid.set(entry.pid, (byPid.get(entry.pid) ?? 0) + delta);
  }
  return byPid;
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

/** Converts cumulative GPU-ns deltas over a wall window into busy percent per pid. */
export function gpuPercentByPid(
  deltaNsByPid: ReadonlyMap<number, number>,
  elapsedMs: number,
  pids: ReadonlyArray<number>,
): Map<number, number> {
  const percents = new Map<number, number>();
  if (elapsedMs <= 0) return percents;
  const scope = new Set(pids);
  for (const [pid, deltaNs] of deltaNsByPid) {
    if (!scope.has(pid)) continue;
    const percent = (deltaNs / (elapsedMs * 1e6)) * 100;
    if (Number.isFinite(percent) && percent > 0) percents.set(pid, percent);
  }
  return percents;
}

async function readAgxSnapshot(): Promise<AgxSnapshot> {
  const { stdout } = await execFile("/bin/sh", [
    "-c",
    "ioreg -c AGXDeviceUserClient -d 1 -r -a | plutil -convert json -o - -",
  ]);
  return parseAgxEntries(JSON.parse(stdout));
}

/**
 * Whole-device GPU utilization percent, parsed from ioreg's text form: the
 * IOAccelerator plist embeds binary blobs that plutil's JSON conversion rejects.
 */
async function readDeviceGpuUtilization(): Promise<number | undefined> {
  try {
    const { stdout } = await execFile("/usr/sbin/ioreg", ["-c", "IOAccelerator", "-d", "1", "-r"]);
    const match = /"Device Utilization %"=(\d+)/.exec(stdout);
    return match?.[1] !== undefined ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cumulative GPU ns for a pid from DRM fdinfo. Multiple fds can point at the
 * same DRM client (dup'ed fds share counters), so totals are deduplicated by
 * drm-client-id. Returns null when the pid exposes no DRM engine counters.
 */
async function readDrmGpuNsForPid(pid: number): Promise<number | null> {
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

interface DarwinBaseline {
  readonly atMs: number;
  readonly entries: ReadonlyMap<number, AgxEntry>;
}

interface LinuxBaseline {
  readonly atMs: number;
  readonly nsByPid: ReadonlyMap<number, number>;
}

export const make = Effect.fn("desktop.gpuTelemetrySampler.make")(function* () {
  const failures = yield* Ref.make(0);
  const disabled = yield* Ref.make(false);
  const darwinBaseline = yield* Ref.make(Option.none<DarwinBaseline>());
  const linuxBaseline = yield* Ref.make(Option.none<LinuxBaseline>());

  const recordFailure = (cause: unknown) =>
    Ref.modify(failures, (count) => [count + 1, count + 1] as const).pipe(
      Effect.flatMap((count) =>
        count < MAX_CONSECUTIVE_FAILURES
          ? Effect.void
          : Ref.set(disabled, true).pipe(
              Effect.andThen(
                Effect.logWarning("GPU telemetry sampling disabled after repeated failures", {
                  cause: String(cause),
                }),
              ),
            ),
      ),
      Effect.as(Option.none<GpuSample>()),
    );

  const sampleDarwin = (pids: ReadonlyArray<number>) =>
    Effect.gen(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const snapshot = yield* Effect.tryPromise({
        try: () => readAgxSnapshot(),
        catch: (cause) => new GpuReadFailed({ cause }),
      });
      if (snapshot.entries.size > 0 && !snapshot.sawAppUsage) {
        return yield* recordFailure(
          "AGXDeviceUserClient entries carry no AppUsage; the macOS GPU registry layout changed",
        );
      }
      yield* Ref.set(failures, 0);
      const previous = yield* Ref.modify(darwinBaseline, (current) => [
        current,
        Option.some({ atMs: now, entries: snapshot.entries }),
      ]);
      if (Option.isNone(previous)) return Option.none<GpuSample>();
      const elapsedMs = now - previous.value.atMs;
      if (elapsedMs <= 0 || elapsedMs > MAX_WINDOW_MS) return Option.none<GpuSample>();
      const deviceUtilizationPercent = yield* Effect.promise(() => readDeviceGpuUtilization());
      return Option.some<GpuSample>({
        backend: "agx",
        gpuPercentByPid: gpuPercentByPid(
          diffAgxGpuNsByPid(previous.value.entries, snapshot.entries),
          elapsedMs,
          pids,
        ),
        deviceUtilizationPercent,
      });
    }).pipe(Effect.catch((cause) => recordFailure(cause)));

  const sampleLinux = (pids: ReadonlyArray<number>) =>
    Effect.gen(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const nsByPid = new Map<number, number>();
      for (const pid of pids) {
        const ns = yield* Effect.promise(() => readDrmGpuNsForPid(pid));
        if (ns !== null) nsByPid.set(pid, ns);
      }
      const previous = yield* Ref.modify(linuxBaseline, (current) => [
        current,
        Option.some({ atMs: now, nsByPid }),
      ]);
      if (nsByPid.size === 0 || Option.isNone(previous)) return Option.none<GpuSample>();
      const elapsedMs = now - previous.value.atMs;
      if (elapsedMs <= 0 || elapsedMs > MAX_WINDOW_MS) return Option.none<GpuSample>();
      const deltaNsByPid = new Map<number, number>();
      for (const [pid, ns] of nsByPid) {
        const priorNs = previous.value.nsByPid.get(pid);
        if (priorNs === undefined) continue;
        deltaNsByPid.set(pid, Math.max(0, ns - priorNs));
      }
      return Option.some<GpuSample>({
        backend: "drm-fdinfo",
        gpuPercentByPid: gpuPercentByPid(deltaNsByPid, elapsedMs, pids),
        deviceUtilizationPercent: undefined,
      });
    });

  const sample: GpuTelemetrySampler["Service"]["sample"] = (pids) =>
    Effect.gen(function* () {
      if (yield* Ref.get(disabled)) return Option.none<GpuSample>();
      if (process.platform === "darwin") return yield* sampleDarwin(pids);
      if (process.platform === "linux") return yield* sampleLinux(pids);
      return Option.none<GpuSample>();
    });

  return GpuTelemetrySampler.of({ sample });
});

export const layer = Layer.effect(GpuTelemetrySampler, make());

export const layerTest = (
  sample?: GpuTelemetrySampler["Service"]["sample"],
): Layer.Layer<GpuTelemetrySampler> =>
  Layer.succeed(
    GpuTelemetrySampler,
    GpuTelemetrySampler.of({
      sample: sample ?? (() => Effect.succeedNone),
    }),
  );
