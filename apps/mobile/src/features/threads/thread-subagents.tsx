import type { ThreadSubagentSummary } from "@t3tools/contracts";
import {
  deriveSidebarSubagents,
  SUBAGENT_STATUS_LABELS,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { memo, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";

export const ThreadSubagents = memo(function ThreadSubagents({
  agents,
  threadTitle,
}: {
  agents: ReadonlyArray<ThreadSubagentSummary> | undefined;
  threadTitle: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(() => deriveSidebarSubagents(agents), [agents]);
  if (model.rows.length === 0) return null;
  return (
    <View className="mx-3 mb-1">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Subagents for ${threadTitle}: ${model.label}`}
        accessibilityHint={expanded ? "Collapses the subagents." : "Expands the subagents."}
        onPress={() => setExpanded((value) => !value)}
        className="min-h-11 flex-row flex-wrap items-center gap-x-2 rounded-lg border border-border-subtle px-2 py-1"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text className="text-xs font-t3-medium text-foreground-muted">Subagents</Text>
        <Text className="flex-1 text-xs tabular-nums text-foreground-muted">{model.label}</Text>
        <Text className="text-xs text-foreground-muted">{expanded ? "Hide" : "Show"}</Text>
      </Pressable>
      {expanded ? (
        <View className="ml-2 mt-1 border-l border-border-subtle pl-2">
          {model.rows.map(({ agent, depth }) => (
            <View
              key={agent.id}
              className="flex-row items-center gap-2 py-1"
              style={{ paddingLeft: Math.min(depth, 4) * 10 }}
            >
              <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
                {agent.title}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {SUBAGENT_STATUS_LABELS[agent.status]}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});
