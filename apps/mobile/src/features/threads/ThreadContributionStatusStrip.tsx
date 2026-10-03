import { useAtomValue } from "@effect/atom-react";
import type { ContributionStatusTone, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import { contributionStatusEnvironment } from "../../state/contribution-status";
import { threadContributionStatusChips } from "./thread-contribution-status-presentation";

// Neutral, the default, has no dot: Pi status text often brings its own glyph.
const TONE_DOT_CLASS = {
  neutral: null,
  info: "bg-adaptive-sky-600-400",
  success: "bg-adaptive-emerald-600-400",
  warning: "bg-adaptive-amber-700-400",
  error: "bg-adaptive-rose-600-400",
} as const satisfies Record<ContributionStatusTone, string | null>;

/**
 * Advisory statuses the thread's provider set, such as Pi extension
 * `setStatus` text, as one row of chips above the composer. Renders nothing
 * when the server lacks the capability or the thread has no statuses.
 * Pressing a chip shows its tooltip and where it came from.
 */
export function ThreadContributionStatusStrip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const entries = useAtomValue(
    contributionStatusEnvironment.threadStatus(props.environmentId, props.threadId),
  );
  const chips = useMemo(() => threadContributionStatusChips(entries), [entries]);
  if (chips.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mb-1.5 grow-0"
      contentContainerClassName="gap-1.5"
    >
      {chips.map((chip) => {
        const dotClass = TONE_DOT_CLASS[chip.tone];
        return (
          <Pressable
            key={chip.id}
            accessibilityRole="button"
            accessibilityLabel={chip.accessibilityLabel}
            accessibilityHint={chip.tooltip ?? chip.help}
            className="h-7 flex-row items-center gap-1.5 rounded-full border border-border-subtle bg-card-alt px-2.5 active:opacity-60"
            onPress={() =>
              Alert.alert(
                chip.text,
                chip.tooltip === null ? chip.help : `${chip.tooltip}\n\n${chip.help}`,
              )
            }
          >
            {chip.leadsSource ? <ProviderIcon provider={chip.driver} size={12} /> : null}
            {dotClass === null ? null : (
              <View className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
            )}
            <Text numberOfLines={1} className="text-xs text-foreground-secondary">
              {chip.text}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
