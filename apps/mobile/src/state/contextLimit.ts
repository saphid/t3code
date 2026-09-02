import type { OrchestrationThreadActivity } from "@t3tools/contracts";

export function threadContextReachedLimit(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  contextTokenLimit: number | undefined,
): boolean {
  if (contextTokenLimit === undefined) return false;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "context-window.updated") continue;
    const payload = activity.payload as Record<string, unknown> | undefined;
    const usedTokens = payload?.usedTokens;
    if (typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0) {
      return usedTokens >= contextTokenLimit;
    }
  }
  return false;
}
