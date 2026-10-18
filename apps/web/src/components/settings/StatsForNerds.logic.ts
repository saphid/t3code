import type { DesktopGpuTelemetry, ResourceTelemetryProcess } from "@t3tools/contracts";

export function formatStatBytes(value: number | null): string {
  if (value === null) return "n/a";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatStatPercent(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

export function formatStatCount(value: number | null): string {
  return value === null ? "n/a" : new Intl.NumberFormat().format(value);
}

/** Highest current CPU first, resident memory as the tiebreaker. */
export function topProcessesByCpu<
  T extends Pick<ResourceTelemetryProcess, "cpuPercent" | "residentBytes">,
>(processes: ReadonlyArray<T>, limit: number): ReadonlyArray<T> {
  return processes
    .toSorted(
      (left, right) =>
        right.cpuPercent - left.cpuPercent || right.residentBytes - left.residentBytes,
    )
    .slice(0, limit);
}

/**
 * The app's GPU busy percent: the sum of per-process attribution, which in a
 * Chromium app lands almost entirely on the single GPU helper process. Null
 * until the environment reports a GPU attribution backend at all.
 */
export function appGpuPercent(
  gpu: DesktopGpuTelemetry | undefined,
  processes: ReadonlyArray<Pick<ResourceTelemetryProcess, "gpuPercent">>,
): number | null {
  if (gpu === undefined || gpu.backend === "none") return null;
  let total = 0;
  for (const process of processes) {
    total += process.gpuPercent ?? 0;
  }
  return total;
}
