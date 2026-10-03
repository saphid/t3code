import {
  type EnvironmentId,
  PLUGIN_NOTIFICATION_MAX_RETAINED,
  type PluginNotification,
  type PluginNotificationCursor,
  type PluginNotificationFrame,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { followStreamInEnvironment } from "./runtime.ts";

export interface ReceivedPluginNotification {
  /** Epoch plus sequence: stable across reconnects, distinct across server restarts. */
  readonly key: string;
  readonly notification: PluginNotification;
}

/**
 * What one environment's plugins sent while this client was subscribed. A
 * renderer shows each `received` key once and closes any shown key that
 * appears in `withdrawn`. Both keep only the newest entries.
 */
export interface PluginNotificationFeed {
  readonly received: ReadonlyArray<ReceivedPluginNotification>;
  readonly withdrawn: ReadonlyArray<string>;
}

export const EMPTY_PLUGIN_NOTIFICATION_FEED: PluginNotificationFeed = {
  received: [],
  withdrawn: [],
};

const notificationKey = (epoch: string, sequence: number) => JSON.stringify([epoch, sequence]);

export function supportsPluginNotifications(config: ServerConfig | null): boolean {
  return config?.environment.capabilities.pluginNotifications === true;
}

/** Adds a frame's new notifications and withdrawals; a repeated notification is ignored. */
export function applyPluginNotificationFrame(
  feed: PluginNotificationFeed,
  frame: PluginNotificationFrame,
): PluginNotificationFeed {
  const known = new Set(feed.received.map((entry) => entry.key));
  const received = frame.notifications
    .map((notification) => ({
      key: notificationKey(frame.epoch, notification.sequence),
      notification,
    }))
    .filter((entry) => !known.has(entry.key));
  const withdrawn = frame.withdrawn.map((sequence) => notificationKey(frame.epoch, sequence));
  if (received.length === 0 && withdrawn.length === 0) return feed;
  return {
    received: [...feed.received, ...received].slice(-PLUGIN_NOTIFICATION_MAX_RETAINED),
    withdrawn: [...feed.withdrawn, ...withdrawn].slice(-PLUGIN_NOTIFICATION_MAX_RETAINED),
  };
}

/**
 * What to do for a feed change: toast every received notification not handled
 * yet, and close every handled one the server withdrew. Marks what it returns
 * as handled, so each notification is toasted once per client lifetime.
 */
export function pluginNotificationChanges(
  feed: PluginNotificationFeed,
  handled: Set<string>,
): {
  readonly show: ReadonlyArray<ReceivedPluginNotification>;
  readonly close: ReadonlyArray<string>;
} {
  const withdrawn = new Set(feed.withdrawn);
  const show = feed.received.filter(
    (entry) => !handled.has(entry.key) && !withdrawn.has(entry.key),
  );
  for (const entry of show) handled.add(entry.key);
  const close = feed.withdrawn.filter((key) => handled.has(key));
  // A withdrawal arriving before its notification still stops a later toast.
  for (const key of feed.withdrawn) handled.add(key);
  return { show, close };
}

/** Says who sent it: plugins share the toast surface with the app itself. */
export function pluginNotificationDescription(entry: ReceivedPluginNotification): string {
  const { pluginName, body } = entry.notification;
  return body === undefined ? `From ${pluginName}` : `${body} · ${pluginName}`;
}

/**
 * Plugin notifications per environment, for toasts on web and mobile. Only
 * servers that advertise the capability are subscribed. The first
 * subscription in a client's life starts live; every resubscription (a
 * reconnect, or a new connection to the same environment) sends the last
 * frame's cursor, so the server replays exactly what was missed.
 */
export function createPluginNotificationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: {
    readonly configValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
  },
) {
  // Outlives the atoms, so a feed rebuilt after going idle still resumes.
  const cursors = new Map<EnvironmentId, PluginNotificationCursor>();
  const subscription = Atom.family((environmentId: EnvironmentId) =>
    runtime
      .atom(
        followStreamInEnvironment(
          environmentId,
          subscribeDynamic(WS_METHODS.pluginsNotificationsSubscribe, () =>
            Effect.sync(() => {
              const after = cursors.get(environmentId);
              return after === undefined ? {} : { after };
            }),
          ).pipe(
            Stream.tap((frame) =>
              Effect.sync(() =>
                cursors.set(environmentId, { epoch: frame.epoch, sequence: frame.sequence }),
              ),
            ),
            Stream.scan(EMPTY_PLUGIN_NOTIFICATION_FEED, applyPluginNotificationFrame),
          ),
        ),
        { initialValue: EMPTY_PLUGIN_NOTIFICATION_FEED },
      )
      .pipe(Atom.withLabel(`environment-data:plugin-notifications:subscription:${environmentId}`)),
  );
  const feed = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): PluginNotificationFeed => {
      if (!supportsPluginNotifications(get(options.configValueAtom(environmentId)))) {
        return EMPTY_PLUGIN_NOTIFICATION_FEED;
      }
      return Option.getOrElse(
        AsyncResult.value(get(subscription(environmentId))),
        () => EMPTY_PLUGIN_NOTIFICATION_FEED,
      );
    }).pipe(Atom.withLabel(`environment-data:plugin-notifications:feed:${environmentId}`)),
  );
  return { feed };
}
