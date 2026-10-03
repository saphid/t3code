/**
 * Plugin notifications and plugin status capabilities.
 *
 * A plugin with the `status` capability sets thread statuses through the
 * contribution status channel (`ContributionStatusSource` kind `plugin`). A
 * plugin with the `notifications` capability sends short notifications that
 * clients show as toasts. Notifications are transient: the server keeps a few
 * recent ones in memory so a client that briefly lost its connection catches
 * up, and nothing survives a server restart. Delivery is best-effort, never
 * durable or loss-free.
 *
 * @module PluginNotifications
 */
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, IsoDateTime, NonNegativeInt, ThreadId } from "./baseSchemas.ts";
import { ContributionStatusTone } from "./contributionStatus.ts";

/** Manifest capability for `context.proposed.status`; requires `proposedApi: true`. */
export const PLUGIN_STATUS_CAPABILITY = "status";
/** Manifest capability for `context.proposed.notify`; requires `proposedApi: true`. */
export const PLUGIN_NOTIFICATIONS_CAPABILITY = "notifications";

export const PLUGIN_NOTIFICATION_TITLE_MAX_LENGTH = 80;
export const PLUGIN_NOTIFICATION_BODY_MAX_LENGTH = 240;
/** Most notifications the server retains, so the most one frame carries. Server-enforced. */
export const PLUGIN_NOTIFICATION_MAX_RETAINED = 20;

const Epoch = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64));

export const PluginNotification = Schema.Struct({
  /** Issue order within the frame's epoch; with the epoch, the notification's identity. */
  sequence: NonNegativeInt,
  pluginId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  /** The plugin's display name from its manifest. */
  pluginName: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100)),
  /** One plain line, normalized by the server like status text. */
  title: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PLUGIN_NOTIFICATION_TITLE_MAX_LENGTH),
  ),
  body: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(PLUGIN_NOTIFICATION_BODY_MAX_LENGTH)),
  ),
  /** Absent means neutral; unknown tones decode as neutral. */
  tone: Schema.optionalKey(ContributionStatusTone),
  /** The thread the notification is about, which clients may offer to open. */
  threadId: Schema.optionalKey(ThreadId),
  createdAt: IsoDateTime,
});
export type PluginNotification = typeof PluginNotification.Type;

/**
 * Where a client is in one server process's notifications. A new epoch means
 * the server restarted and its sequences started again.
 */
export const PluginNotificationCursor = Schema.Struct({
  epoch: Epoch,
  sequence: NonNegativeInt,
});
export type PluginNotificationCursor = typeof PluginNotificationCursor.Type;

/**
 * Without `after` the stream starts live: a client that has seen nothing yet
 * (a fresh page or app launch) is not shown older notifications. With the
 * cursor of the last frame it received, the first frame replays the retained
 * notifications it missed, so a reconnect neither drops nor repeats them.
 */
export const PluginNotificationsSubscribeInput = Schema.Struct({
  after: Schema.optionalKey(PluginNotificationCursor),
});
export type PluginNotificationsSubscribeInput = typeof PluginNotificationsSubscribeInput.Type;

/**
 * One frame of `plugins.notifications.subscribe`. The first frame of every
 * subscription carries the replay (often empty); later frames carry one new
 * notification, or withdraw ones whose plugin stopped. `epoch` and `sequence`
 * form the cursor to resubscribe with.
 */
export const PluginNotificationFrame = Schema.Struct({
  epoch: Epoch,
  /** The newest sequence the server had issued when it sent this frame. */
  sequence: NonNegativeInt,
  /** Oldest first; at most PLUGIN_NOTIFICATION_MAX_RETAINED. */
  notifications: ForwardCompatibleArray(PluginNotification),
  /**
   * Sequences of this epoch's notifications whose plugin was disabled, removed
   * or stopped. Clients close them if they are still shown.
   */
  withdrawn: Schema.Array(NonNegativeInt),
});
export type PluginNotificationFrame = typeof PluginNotificationFrame.Type;
