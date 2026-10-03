import { useAtomValue } from "@effect/atom-react";
import { useLinkTo } from "@react-navigation/native";
import {
  pluginNotificationChanges,
  pluginNotificationDescription,
  type ReceivedPluginNotification,
} from "@t3tools/client-runtime/state/plugin-notifications";
import type { ContributionStatusTone, EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useEnvironments } from "../../state/environments";
import { pluginNotificationEnvironment } from "../../state/plugin-notifications";

const SHOWN_MS = 5_000;
/** Banners waiting their turn; older ones are dropped past this. */
const MAX_QUEUED = 5;

const TONE_DOT_CLASS = {
  neutral: "bg-foreground-muted",
  info: "bg-adaptive-sky-600-400",
  success: "bg-adaptive-emerald-600-400",
  warning: "bg-adaptive-amber-700-400",
  error: "bg-adaptive-rose-600-400",
} as const satisfies Record<ContributionStatusTone, string>;

interface Banner {
  readonly environmentId: EnvironmentId;
  readonly entry: ReceivedPluginNotification;
}

/**
 * Plugin notifications as an in-app banner under the status bar, one at a
 * time for a few seconds each. Only notifications that arrive while the app
 * is open are shown; tapping one about a thread opens it, and a banner whose
 * plugin was disabled or stopped goes away.
 */
export function PluginNotificationBannerHost() {
  const { environments } = useEnvironments();
  const [queue, setQueue] = useState<ReadonlyArray<Banner>>([]);
  const onChanges = useCallback(
    (
      environmentId: EnvironmentId,
      show: ReadonlyArray<ReceivedPluginNotification>,
      close: ReadonlyArray<string>,
    ) =>
      setQueue((current) =>
        [
          ...current.filter(
            (banner) => banner.environmentId !== environmentId || !close.includes(banner.entry.key),
          ),
          ...show.map((entry) => ({ environmentId, entry })),
        ].slice(-MAX_QUEUED),
      ),
    [],
  );
  const dismiss = useCallback(
    (banner: Banner) => setQueue((current) => current.filter((each) => each !== banner)),
    [],
  );
  const head = queue[0];

  useEffect(() => {
    if (head === undefined) return;
    const timer = setTimeout(() => dismiss(head), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [dismiss, head]);

  return (
    <>
      {environments.map((environment) => (
        <EnvironmentPluginNotifications
          key={environment.environmentId}
          environmentId={environment.environmentId}
          onChanges={onChanges}
        />
      ))}
      {head === undefined ? null : <PluginNotificationBanner banner={head} onDone={dismiss} />}
    </>
  );
}

function EnvironmentPluginNotifications(props: {
  readonly environmentId: EnvironmentId;
  readonly onChanges: (
    environmentId: EnvironmentId,
    show: ReadonlyArray<ReceivedPluginNotification>,
    close: ReadonlyArray<string>,
  ) => void;
}) {
  const { environmentId, onChanges } = props;
  const feed = useAtomValue(pluginNotificationEnvironment.feed(environmentId));
  // Null until the first feed is seen: whatever it already holds is history, not news.
  const handled = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (handled.current === null) {
      handled.current = new Set([...feed.received.map((entry) => entry.key), ...feed.withdrawn]);
      return;
    }
    const { show, close } = pluginNotificationChanges(feed, handled.current);
    if (show.length > 0 || close.length > 0) onChanges(environmentId, show, close);
  }, [environmentId, feed, onChanges]);

  return null;
}

function PluginNotificationBanner(props: {
  readonly banner: Banner;
  readonly onDone: (banner: Banner) => void;
}) {
  const { banner, onDone } = props;
  const insets = useSafeAreaInsets();
  const linkTo = useLinkTo();
  const { threadId, title, tone } = banner.entry.notification;
  const description = pluginNotificationDescription(banner.entry);

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 items-center px-3"
      style={{ top: insets.top + 4 }}
    >
      <Pressable
        accessibilityRole={threadId === undefined ? "button" : "link"}
        accessibilityLabel={`${title}. ${description}`}
        accessibilityHint={
          threadId === undefined ? "Dismisses the notification" : "Opens the thread"
        }
        className="w-full max-w-[480px] flex-row items-start gap-2.5 rounded-2xl border border-border-subtle bg-card-alt px-3.5 py-3 active:opacity-70"
        onPress={() => {
          onDone(banner);
          if (threadId !== undefined)
            linkTo(
              `/threads/${encodeURIComponent(banner.environmentId)}/${encodeURIComponent(threadId)}`,
            );
        }}
      >
        <View
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT_CLASS[tone ?? "neutral"])}
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
            {title}
          </Text>
          <Text numberOfLines={2} className="text-xs text-foreground-secondary">
            {description}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
