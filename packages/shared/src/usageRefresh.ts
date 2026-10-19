// @effect-diagnostics globalTimers:off
/** Refresh cadence for a usage page that remains mounted. */
export const USAGE_AUTO_REFRESH_MS = 30 * 60 * 1000;

/**
 * Starts the page-lifetime refresh timer. The initial atom read performs the
 * page-load scan, so the timer deliberately waits one complete interval.
 */
export function startUsageAutoRefresh(refresh: () => void): () => void {
  const timer = globalThis.setInterval(refresh, USAGE_AUTO_REFRESH_MS);
  return () => globalThis.clearInterval(timer);
}
