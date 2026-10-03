import {
  type ContributionStatusEntry,
  type ContributionStatusSource,
  type ContributionStatusTone,
  contributionStatusSourceKey,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
} from "@t3tools/contracts";

export interface ThreadContributionStatusChip {
  /** Source key plus item key, so a provider session taking over re-keys the chip. */
  readonly id: string;
  /** The provider that set it, or null for a plugin's status. */
  readonly driver: ProviderDriverKind | null;
  /** The first chip of each provider source carries that provider's icon. */
  readonly leadsSource: boolean;
  readonly text: string;
  readonly tone: ContributionStatusTone;
  readonly tooltip: string | null;
  readonly accessibilityLabel: string;
  /** Says where the status came from and that it can lag; never "current session". */
  readonly help: string;
}

function providerLabel(driver: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[driver] ?? driver;
}

function sourceLabel(source: ContributionStatusSource): string {
  return source.kind === "plugin" ? source.name : providerLabel(source.driver);
}

function statusHelp(source: ContributionStatusSource): string {
  if (source.kind === "plugin") return `Set by the ${source.name} plugin.`;
  const origin = source.driver === "pi" ? "a Pi extension" : providerLabel(source.driver);
  return `Set by ${origin}. It can lag a session change.`;
}

/** Flattens a thread's status entries into chips, in the server's order. */
export function threadContributionStatusChips(
  entries: ReadonlyArray<ContributionStatusEntry>,
): ReadonlyArray<ThreadContributionStatusChip> {
  return entries.flatMap((entry) => {
    const { source } = entry;
    const sourceKey = contributionStatusSourceKey(source);
    return entry.items.map((item, index) => ({
      id: JSON.stringify([sourceKey, item.key]),
      driver: source.kind === "plugin" ? null : source.driver,
      leadsSource: index === 0,
      text: item.text,
      tone: item.tone ?? "neutral",
      tooltip: item.tooltip ?? null,
      accessibilityLabel: `${sourceLabel(source)} status: ${item.text}`,
      help: statusHelp(source),
    }));
  });
}
