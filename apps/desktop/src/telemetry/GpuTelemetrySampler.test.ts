import { assert, describe, it } from "@effect/vitest";

import {
  diffAgxGpuNsByPid,
  gpuPercentByPid,
  parseAgxEntries,
  parseDrmEngineNs,
} from "./GpuTelemetrySampler.ts";

function agxEntry(entryId: number, pid: number, gpuTimeNs: number) {
  return {
    IORegistryEntryID: entryId,
    IOUserClientCreator: `pid ${pid}, T3 Code Helper (GPU)`,
    AppUsage: [{ accumulatedGPUTime: gpuTimeNs }],
  };
}

describe("GpuTelemetrySampler", () => {
  it("parses AGX entries keyed by registry entry id", () => {
    const snapshot = parseAgxEntries([
      agxEntry(11, 500, 1_000_000),
      {
        IORegistryEntryID: 12,
        IOUserClientCreator: "pid 500, T3 Code Helper (GPU)",
        AppUsage: [{ accumulatedGPUTime: 2_000_000 }, { accumulatedGPUTime: 500_000 }],
      },
      { IORegistryEntryID: 13, IOUserClientCreator: "no pid here", AppUsage: [] },
      { IORegistryEntryID: 14, IOUserClientCreator: "pid 900, other" },
    ]);
    assert.isTrue(snapshot.sawClient);
    assert.isTrue(snapshot.sawAppUsage);
    assert.equal(snapshot.entries.size, 2);
    assert.equal(snapshot.entries.get(12)?.pid, 500);
    assert.equal(snapshot.entries.get(12)?.gpuTimeNs, 2_500_000);
  });

  it("flags a registry layout without AppUsage", () => {
    const snapshot = parseAgxEntries([
      { IORegistryEntryID: 11, IOUserClientCreator: "pid 500, helper" },
    ]);
    assert.isTrue(snapshot.sawClient);
    assert.isFalse(snapshot.sawAppUsage);
    assert.equal(snapshot.entries.size, 0);
  });

  it("distinguishes a host without AGX clients from a changed registry layout", () => {
    const snapshot = parseAgxEntries([]);
    assert.isFalse(snapshot.sawClient);
    assert.isFalse(snapshot.sawAppUsage);
    assert.equal(snapshot.entries.size, 0);
  });

  it("diffs AGX snapshots per pid, counting new queues fully and ignoring pid reuse", () => {
    const before = parseAgxEntries([agxEntry(11, 500, 1_000_000), agxEntry(12, 700, 400_000)]);
    const after = parseAgxEntries([
      agxEntry(11, 500, 3_000_000),
      // Entry 12 now belongs to a different pid: prior time must not be subtracted.
      agxEntry(12, 701, 100_000),
      // Entry 13 was created inside the window: its full time counts.
      agxEntry(13, 500, 250_000),
    ]);
    const deltas = diffAgxGpuNsByPid(before.entries, after.entries);
    assert.equal(deltas.get(500), 2_250_000);
    assert.equal(deltas.get(701), 100_000);
    assert.isUndefined(deltas.get(700));
  });

  it("converts GPU-ns deltas into busy percent scoped to the requested pids", () => {
    const percents = gpuPercentByPid(
      new Map([
        [500, 500_000_000],
        [900, 1_000_000_000],
      ]),
      1_000,
      [500],
    );
    assert.equal(percents.get(500), 50);
    assert.isUndefined(percents.get(900));
    assert.equal(gpuPercentByPid(new Map([[500, 1]]), 0, [500]).size, 0);
  });

  it("sums drm-engine counters and reads the drm client id", () => {
    const parsed = parseDrmEngineNs(
      [
        "pos:\t0",
        "drm-client-id:\t42",
        "drm-engine-render:\t1000000 ns",
        "drm-engine-copy:\t250000 ns",
      ].join("\n"),
    );
    assert.deepEqual(parsed, { clientId: "42", ns: 1_250_000 });
    assert.isNull(parseDrmEngineNs("pos:\t0\nflags:\t02"));
  });
});
