import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  limitsNotice,
  providersWithLimits,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";

export interface SubscriptionUsageRow {
  readonly label: string;
  readonly window: string;
  // Omit unavailable values: iOS widget storage accepts property lists, not null.
  readonly usedPercent?: number;
  readonly resetLabel: string;
  readonly expiresAt: number;
  readonly checkedAt: number;
}

export interface SubscriptionUsageSnapshot {
  readonly rows: readonly SubscriptionUsageRow[];
  readonly totalRows: number;
  readonly deepLink: string;
}

const MAX_AGE = 30 * 60_000;

/** Only display data crosses into OS storage; credentials and emails stay in the app. */
export function buildSubscriptionUsageSnapshot(
  presentations: LimitPresentations,
  deepLink: string,
): SubscriptionUsageSnapshot {
  const rows: SubscriptionUsageRow[] = [];
  const add = (label: string, limits: ServerProviderUsageLimits) => {
    const parsedCheckedAt = Date.parse(limits.checkedAt);
    const checkedAt = Number.isFinite(parsedCheckedAt) ? parsedCheckedAt : 0;
    if (limits.unavailable || limits.windows.length === 0) {
      rows.push({
        label,
        window:
          limits.unavailable?.reason === "unsupported"
            ? "No subscription limits"
            : "Limits unavailable",
        resetLabel: "Open app for details",
        checkedAt,
        expiresAt: 0,
      });
      return;
    }
    for (const window of limits.windows) {
      const reset = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
      rows.push({
        label,
        window: window.label,
        usedPercent: Math.round(Math.max(0, Math.min(100, window.usedPercent))),
        resetLabel: Number.isFinite(reset)
          ? `Resets ${new Date(reset).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : "Reset time unavailable",
        checkedAt,
        expiresAt:
          checkedAt === 0
            ? 0
            : Math.min(checkedAt + MAX_AGE, Number.isFinite(reset) ? reset : Infinity),
      });
    }
  };
  const driverLabels: Readonly<Record<string, string>> = { codex: "Codex", claudeAgent: "Claude" };
  // Home screens have no reveal control, so email-bearing names use a generic label.
  const safeLabel = (value: string | null | undefined, fallback: string) =>
    value?.trim() && !value.includes("@") ? value.trim() : fallback;
  for (const [index, account] of collectLimitAccounts(presentations).entries()) {
    const driver = driverLabels[account.driver] ?? String(account.driver);
    const name = safeLabel(account.displayName, driver);
    const origin = account.sourceLabel
      ? safeLabel(account.sourceLabel, "Hub")
      : presentations.size > 1
        ? account.environments.map((entry) => safeLabel(entry.label, "Environment")).join(", ")
        : "";
    add(
      origin ? `${origin} · ${name}${account.sourceLabel ? ` ${index + 1}` : ""}` : name,
      account.limits,
    );
  }
  // Usable quotas come exclusively from the shared account selection. Keep
  // unavailable readings visible without copying private probe errors to OS storage.
  for (const presentation of presentations.values()) {
    const label = (name: string) =>
      presentations.size > 1
        ? `${safeLabel(presentation.entry.target.label, "Environment")} · ${name}`
        : name;
    for (const provider of providersWithLimits(presentation.serverConfig?.providers ?? [])) {
      if (!provider.usageLimits || limitsNotice(provider.usageLimits) === null) continue;
      add(
        label(
          safeLabel(provider.displayName, driverLabels[provider.driver] ?? String(provider.driver)),
        ),
        provider.usageLimits,
      );
    }
    for (const source of presentation.serverConfig?.usageLimitSources ?? []) {
      const name = label(safeLabel(source.label, "Hub"));
      for (const [index, account] of source.accounts.entries()) {
        if (limitsNotice(account.usageLimits) === null) continue;
        add(
          `${name} · ${driverLabels[account.driver] ?? account.driver} ${index + 1}`,
          account.usageLimits,
        );
      }
      if (source.error && source.accounts.length === 0) {
        add(name, { checkedAt: source.checkedAt, windows: [] });
      }
    }
  }
  // Most constrained windows stay visible in the smallest families. Stable
  // sorting preserves account order when two windows have the same quota.
  rows.sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1));
  return { rows: rows.slice(0, 8), totalRows: rows.length, deepLink };
}

/** Schedule expiry without pretending that a reset supplies a fresh quota reading. */
export function subscriptionUsageTimeline(snapshot: SubscriptionUsageSnapshot, now: number) {
  const dates = [
    now,
    ...new Set(snapshot.rows.map((row) => row.expiresAt).filter((at) => at > now)),
  ];
  return dates.sort((a, b) => a - b).map((at) => ({ date: new Date(at), props: snapshot }));
}
