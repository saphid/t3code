import {
  type ContributionStatusEntry,
  type ContributionStatusTone,
  contributionStatusSourceKey,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
} from "@t3tools/contracts";

export interface ThreadContributionStatusChip {
  /** Source key plus item key, so a provider session taking over re-keys the chip. */
  readonly id: string;
  readonly driver: ProviderDriverKind;
  /** The first chip of each source carries that source's provider icon. */
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

function statusHelp(driver: ProviderDriverKind): string {
  const origin = driver === "pi" ? "a Pi extension" : providerLabel(driver);
  return `Set by ${origin}. It can lag a session change.`;
}

/** Flattens a thread's status entries into chips, in the server's order. */
export function threadContributionStatusChips(
  entries: ReadonlyArray<ContributionStatusEntry>,
): ReadonlyArray<ThreadContributionStatusChip> {
  return entries.flatMap((entry) => {
    const sourceKey = contributionStatusSourceKey(entry.source);
    const { driver } = entry.source;
    return entry.items.map((item, index) => ({
      id: JSON.stringify([sourceKey, item.key]),
      driver,
      leadsSource: index === 0,
      text: item.text,
      tone: item.tone ?? "neutral",
      tooltip: item.tooltip ?? null,
      accessibilityLabel: `${providerLabel(driver)} status: ${item.text}`,
      help: statusHelp(driver),
    }));
  });
}
