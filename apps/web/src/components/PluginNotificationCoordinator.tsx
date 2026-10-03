import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  pluginNotificationChanges,
  pluginNotificationDescription,
} from "@t3tools/client-runtime/state/plugin-notifications";
import { useEffect, useRef } from "react";

import { useEnvironmentIds } from "../state/environments";
import { usePluginNotificationFeed } from "../state/pluginNotifications";
import { toastManager } from "./ui/toast";

/**
 * Shows plugin notifications as toasts, for every environment whose server
 * supports them. Only notifications that arrive while the app is open are
 * shown; a toast whose plugin was disabled or stopped closes.
 */
export function PluginNotificationCoordinator() {
  const environmentIds = useEnvironmentIds();
  return environmentIds.map((environmentId) => (
    <EnvironmentPluginNotifications key={environmentId} environmentId={environmentId} />
  ));
}

function EnvironmentPluginNotifications({ environmentId }: { environmentId: EnvironmentId }) {
  const feed = usePluginNotificationFeed(environmentId);
  const navigate = useNavigate();
  // Null until the first feed is seen: whatever it already holds is history, not news.
  const handled = useRef<Set<string> | null>(null);
  const toasts = useRef(new Map<string, ReturnType<typeof toastManager.add>>());

  useEffect(() => {
    if (handled.current === null) {
      handled.current = new Set([...feed.received.map((entry) => entry.key), ...feed.withdrawn]);
      return;
    }
    const { show, close } = pluginNotificationChanges(feed, handled.current);
    for (const key of close) {
      const toastId = toasts.current.get(key);
      if (toastId === undefined) continue;
      toasts.current.delete(key);
      toastManager.close(toastId);
    }
    for (const entry of show) {
      const { threadId, title, tone } = entry.notification;
      const toastId = toastManager.add({
        ...(tone === undefined || tone === "neutral" ? {} : { type: tone }),
        title,
        description: pluginNotificationDescription(entry),
        data: { hideCopyButton: true },
        ...(threadId === undefined
          ? {}
          : {
              actionProps: {
                children: "Open thread",
                onClick: () => {
                  toastManager.close(toastId);
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: { environmentId, threadId },
                  });
                },
              },
            }),
      });
      toasts.current.set(entry.key, toastId);
    }
    // Only keys the feed still holds can be withdrawn later.
    const current = new Set(feed.received.map((entry) => entry.key));
    for (const key of toasts.current.keys()) if (!current.has(key)) toasts.current.delete(key);
  }, [environmentId, feed, navigate]);

  return null;
}
