import { useEffect, useState } from "react";

/** Long tasks older than this fall out of the rolling summary. */
const LONG_TASK_WINDOW_MS = 30_000;

export interface RendererLongTaskStats {
  readonly count: number;
  readonly totalMs: number;
  readonly longestMs: number;
}

export interface RendererPerformanceStats {
  readonly jsHeapUsedBytes: number | null;
  readonly jsHeapTotalBytes: number | null;
  readonly jsHeapLimitBytes: number | null;
  readonly domNodeCount: number;
  readonly framesPerSecond: number | null;
  readonly longTasks: RendererLongTaskStats;
}

interface RecordedLongTask {
  readonly endedAtMs: number;
  readonly durationMs: number;
}

/** Chromium-only heap counters; absent in other engines. */
interface ChromiumMemoryInfo {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

function readJsHeap(): Pick<
  RendererPerformanceStats,
  "jsHeapUsedBytes" | "jsHeapTotalBytes" | "jsHeapLimitBytes"
> {
  const memory = (performance as Performance & { memory?: ChromiumMemoryInfo }).memory;
  if (memory === undefined) {
    return { jsHeapUsedBytes: null, jsHeapTotalBytes: null, jsHeapLimitBytes: null };
  }
  return {
    jsHeapUsedBytes: memory.usedJSHeapSize,
    jsHeapTotalBytes: memory.totalJSHeapSize,
    jsHeapLimitBytes: memory.jsHeapSizeLimit,
  };
}

export function summarizeLongTasks(tasks: ReadonlyArray<RecordedLongTask>): RendererLongTaskStats {
  let totalMs = 0;
  let longestMs = 0;
  for (const task of tasks) {
    totalMs += task.durationMs;
    if (task.durationMs > longestMs) longestMs = task.durationMs;
  }
  return { count: tasks.length, totalMs, longestMs };
}

function readInstantStats(): RendererPerformanceStats {
  return {
    ...readJsHeap(),
    domNodeCount: document.getElementsByTagName("*").length,
    framesPerSecond: null,
    longTasks: { count: 0, totalMs: 0, longestMs: 0 },
  };
}

/**
 * Samples this window's own runtime cost (JS heap, DOM size, frame rate, and
 * main-thread long tasks) once per interval, but only while the consuming
 * component is mounted and the document is visible. Nothing runs when the
 * stats page is closed, so the sampler can never become ambient overhead.
 */
export function useRendererPerformance(intervalMs = 1_000): RendererPerformanceStats {
  const [stats, setStats] = useState<RendererPerformanceStats>(readInstantStats);

  useEffect(() => {
    let frameCount = 0;
    let rafId: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastTickAt = performance.now();
    let longTasks: Array<RecordedLongTask> = [];

    const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push({
              endedAtMs: entry.startTime + entry.duration,
              durationMs: entry.duration,
            });
          }
        })
      : null;
    observer?.observe({ type: "longtask", buffered: true });

    const onFrame = () => {
      frameCount += 1;
      rafId = requestAnimationFrame(onFrame);
    };
    const tick = () => {
      const now = performance.now();
      const elapsedMs = now - lastTickAt;
      lastTickAt = now;
      const frames = frameCount;
      frameCount = 0;
      longTasks = longTasks.filter((task) => now - task.endedAtMs <= LONG_TASK_WINDOW_MS);
      setStats({
        ...readJsHeap(),
        domNodeCount: document.getElementsByTagName("*").length,
        framesPerSecond: elapsedMs > 0 ? Math.round((frames * 1_000) / elapsedMs) : null,
        longTasks: summarizeLongTasks(longTasks),
      });
    };

    const start = () => {
      if (timer !== null) return;
      lastTickAt = performance.now();
      frameCount = 0;
      rafId = requestAnimationFrame(onFrame);
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();

    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);

  return stats;
}
