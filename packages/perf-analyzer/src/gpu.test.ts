import { describe, expect, it } from "@effect/vitest";

import { diffGpu, parseAgxEntries, parseDrmEngineNs } from "./gpu.ts";

const entry = (entryId: number, pid: number, gpuTimeNs: number) => ({
  IORegistryEntryID: entryId,
  IOUserClientCreator: `pid ${pid}, SomeProcess`,
  AppUsage: [{ API: "Metal", accumulatedGPUTime: gpuTimeNs, lastSubmittedTime: 0 }],
});

describe("parseAgxEntries", () => {
  it("sums AppUsage per registry entry and extracts the creator pid", () => {
    const snapshot = parseAgxEntries([
      {
        ...entry(1, 100, 5),
        AppUsage: [
          { API: "Metal", accumulatedGPUTime: 5 },
          { API: "Metal", accumulatedGPUTime: 7 },
        ],
      },
    ]);
    expect(snapshot.entries.get(1)).toEqual({ entryId: 1, pid: 100, gpuTimeNs: 12 });
  });

  it("fails loudly when the registry layout changes", () => {
    expect(() =>
      parseAgxEntries([{ IORegistryEntryID: 1, IOUserClientCreator: "pid 1, x" }]),
    ).toThrow(/layout has changed/);
  });
});

describe("parseDrmEngineNs", () => {
  it("sums engine counters and extracts the client id", () => {
    const text = [
      "pos:\t0",
      "drm-driver:\tamdgpu",
      "drm-client-id:\t42",
      "drm-engine-gfx:\t123456789 ns",
      "drm-engine-compute:\t1000 ns",
      "drm-engine-dma:\t0 ns",
    ].join("\n");
    expect(parseDrmEngineNs(text)).toEqual({ clientId: "42", ns: 123457789 });
  });

  it("returns null for fds without DRM counters", () => {
    expect(parseDrmEngineNs("pos:\t0\nflags:\t02004002\n")).toBeNull();
  });
});

describe("diffGpu", () => {
  it("attributes deltas per pid and counts new queues fully", () => {
    const before = parseAgxEntries([entry(1, 100, 1000), entry(2, 200, 500)]);
    const after = parseAgxEntries([
      entry(1, 100, 4000),
      entry(2, 200, 500),
      entry(3, 100, 250),
    ]);
    const deltas = diffGpu(before, after);
    expect(deltas.get(100)).toBe(3250);
    expect(deltas.has(200)).toBe(false);
  });

  it("clamps counter resets to zero", () => {
    const before = parseAgxEntries([entry(1, 100, 9000)]);
    const after = parseAgxEntries([entry(1, 100, 100)]);
    expect(diffGpu(before, after).has(100)).toBe(false);
  });
});
