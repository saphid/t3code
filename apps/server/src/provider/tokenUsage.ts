import type { ThreadTokenUsageSnapshot } from "@t3tools/contracts";

export function finiteNonNegativeTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const count = Math.trunc(value);
  return count >= 0 ? count : undefined;
}

export function finitePositiveTokenCount(value: unknown): number | undefined {
  const count = finiteNonNegativeTokenCount(value);
  return count !== undefined && count > 0 ? count : undefined;
}

export function shouldEmitTokenUsage(
  previous: ThreadTokenUsageSnapshot | undefined,
  next: ThreadTokenUsageSnapshot,
): boolean {
  if (!previous) {
    return true;
  }
  if (next.usedTokens < previous.usedTokens) {
    return false;
  }
  if (previous.maxTokens !== undefined && next.maxTokens !== undefined) {
    const previousFraction = previous.usedTokens / previous.maxTokens;
    const nextFraction = next.usedTokens / next.maxTokens;
    if (nextFraction < previousFraction) {
      return false;
    }
  }
  return next.usedTokens > previous.usedTokens || previous.maxTokens !== next.maxTokens;
}

export function retainKnownTokenUsageMaximum(
  previous: ThreadTokenUsageSnapshot | undefined,
  next: ThreadTokenUsageSnapshot,
): ThreadTokenUsageSnapshot {
  if (next.maxTokens !== undefined || previous?.maxTokens === undefined) {
    return next;
  }
  return { ...next, maxTokens: previous.maxTokens };
}
