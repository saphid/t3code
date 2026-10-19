import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startUsageAutoRefresh, USAGE_AUTO_REFRESH_MS } from "./usageRefresh.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("startUsageAutoRefresh", () => {
  it("waits thirty minutes, repeats, and stops after cleanup", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const stop = startUsageAutoRefresh(refresh);

    vi.advanceTimersByTime(USAGE_AUTO_REFRESH_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(USAGE_AUTO_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(USAGE_AUTO_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
