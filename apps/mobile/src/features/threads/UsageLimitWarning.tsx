import type { ServerProvider } from "@t3tools/contracts";
import { exhaustedUsageWindow, formatUsageLimitWarning } from "@t3tools/shared/usageLimits";
import { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { providerDisplayLabel } from "../../lib/modelOptions";

/**
 * Warns above a composer when the selected provider reports a spent window
 * for the selected model. Sending stays allowed. While shown it re-reads the
 * clock each minute, so the countdown stays current and it clears at reset.
 */
export function UsageLimitWarning(props: {
  readonly provider: ServerProvider | null;
  readonly model: string | null;
  readonly providerLocked: boolean;
  readonly onPress?: (() => void) | undefined;
}) {
  const [, setTick] = useState(0);
  const now = Date.now();
  const exhausted =
    props.model === null ? null : exhaustedUsageWindow(props.provider, props.model, now);
  const visible = exhausted !== null;
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => clearInterval(id);
  }, [visible]);
  if (exhausted === null || props.provider === null) return null;
  return (
    <Pressable
      accessibilityRole={props.onPress ? "button" : undefined}
      className="px-3 py-2"
      disabled={!props.onPress}
      onPress={props.onPress}
    >
      <Text className="text-xs text-foreground">
        {formatUsageLimitWarning(providerDisplayLabel(props.provider), exhausted, now, {
          providerLocked: props.providerLocked,
        })}
      </Text>
    </Pressable>
  );
}
