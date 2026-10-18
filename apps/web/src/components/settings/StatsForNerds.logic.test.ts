import { describe, expect, it } from "vite-plus/test";

import {
  appGpuPercent,
  formatStatBytes,
  formatStatPercent,
  topProcessesByCpu,
} from "./StatsForNerds.logic";

describe("StatsForNerds formatting", () => {
  it("formats bytes and percents with an n/a fallback", () => {
    expect(formatStatBytes(null)).toBe("n/a");
    expect(formatStatBytes(512)).toBe("512 B");
    expect(formatStatBytes(2.5 * 1024 * 1024)).toBe("2.50 MB");
    expect(formatStatPercent(null)).toBe("n/a");
    expect(formatStatPercent(12.34)).toBe("12.3%");
  });
});

describe("topProcessesByCpu", () => {
  it("ranks by CPU with resident memory as the tiebreaker", () => {
    const ranked = topProcessesByCpu(
      [
        { pid: 1, cpuPercent: 5, residentBytes: 0 },
        { pid: 2, cpuPercent: 80, residentBytes: 0 },
        { pid: 3, cpuPercent: 5, residentBytes: 4_096 },
      ],
      2,
    );
    expect(ranked.map((process) => process.pid)).toEqual([2, 3]);
  });
});

describe("appGpuPercent", () => {
  it("sums per-process attribution only when a backend reported", () => {
    expect(
      appGpuPercent({ backend: "agx", deviceUtilizationPercent: 40 }, [
        { gpuPercent: 12.5 },
        { gpuPercent: 2.5 },
        {},
      ]),
    ).toBe(15);
    expect(appGpuPercent(undefined, [{ gpuPercent: 12.5 }])).toBe(null);
    expect(appGpuPercent({ backend: "none" }, [{ gpuPercent: 12.5 }])).toBe(null);
  });
});
