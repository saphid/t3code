/**
 * Notifications sent by plugins with the `notifications` capability, shown by
 * clients as toasts.
 *
 * Delivery is best-effort and in memory only. The server retains the last
 * `PLUGIN_NOTIFICATION_MAX_RETAINED` notifications for `retentionMillis` so a
 * client that reconnects with its cursor gets the ones it missed exactly once;
 * a client without a cursor starts live. A server restart starts a new epoch
 * with nothing retained. When a plugin's process stops (disable, remove,
 * crash) its retained notifications are dropped and withdrawn from clients.
 */
import {
  PLUGIN_NOTIFICATION_BODY_MAX_LENGTH,
  PLUGIN_NOTIFICATION_MAX_RETAINED,
  PLUGIN_NOTIFICATION_TITLE_MAX_LENGTH,
  PLUGIN_NOTIFICATIONS_CAPABILITY,
  type PluginNotification,
  type PluginNotificationFrame,
  type PluginNotificationsSubscribeInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { normalizeContributionStatusText } from "../contributions/ContributionStatusStore.ts";
import {
  PluginHostCallError,
  type PluginHostMethod,
  PluginSupervisor,
} from "./PluginSupervisor.ts";
import { makeTokenBucket } from "./pluginTokenBucket.ts";

/**
 * Retention covers a short disconnect, not history. Per plugin process,
 * `burst` notifications at once, then one per `refillMillis`; a subscriber
 * more than `subscriberBuffer` frames behind skips the oldest.
 */
export const PLUGIN_NOTIFICATION_LIMITS = {
  retained: PLUGIN_NOTIFICATION_MAX_RETAINED,
  retentionMillis: 2 * 60_000,
  burst: 5,
  refillMillis: 5_000,
  subscriberBuffer: 64,
} as const;

const decodeShowInput = Schema.decodeUnknownEffect(
  Schema.Struct({
    title: Schema.String,
    body: Schema.optionalKey(Schema.String),
    tone: Schema.optionalKey(Schema.Literals(["neutral", "info", "success", "warning", "error"])),
    threadId: Schema.optionalKey(ThreadId),
  }),
);

const hostError = (message: string) => new PluginHostCallError({ message });
const STOPPED = hostError("The plugin was stopped.");

interface Retained {
  readonly notification: PluginNotification;
  readonly expiresAt: number;
  readonly lifetime: Scope.Scope;
}

interface Generation {
  readonly bucket: ReturnType<typeof makeTokenBucket>;
  closed: boolean;
}

export class PluginNotifications extends Context.Service<
  PluginNotifications,
  {
    /** The first frame replays what `after` missed (nothing without it), then one frame per change. */
    readonly subscribe: (
      input: PluginNotificationsSubscribeInput,
    ) => Stream.Stream<PluginNotificationFrame>;
  }
>()("t3/plugins/PluginNotifications") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("PluginNotifications.make")(function* () {
  const supervisor = yield* PluginSupervisor;
  const crypto = yield* Crypto.Crypto;
  const epoch = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  const frames = yield* PubSub.sliding<PluginNotificationFrame>(
    PLUGIN_NOTIFICATION_LIMITS.subscriberBuffer,
  );
  // Orders issue, withdrawal and each subscriber's replay against one another.
  const lock = yield* Semaphore.make(1);
  const generations = new WeakMap<Scope.Scope, Generation>();
  let sequence = 0;
  let retained: ReadonlyArray<Retained> = [];

  const prune = (now: number) => {
    retained = retained.filter((entry) => entry.expiresAt > now);
  };

  const frame = (
    notifications: ReadonlyArray<PluginNotification>,
    withdrawn: ReadonlyArray<number>,
  ): PluginNotificationFrame => ({ epoch, sequence, notifications, withdrawn });

  /** Drops a stopped process's notifications and tells clients to close them. */
  const withdraw = (lifetime: Scope.Scope) =>
    lock.withPermit(
      Effect.suspend(() => {
        const withdrawn = retained
          .filter((entry) => entry.lifetime === lifetime)
          .map((entry) => entry.notification.sequence);
        if (withdrawn.length === 0) return Effect.void;
        retained = retained.filter((entry) => entry.lifetime !== lifetime);
        return PubSub.publish(frames, frame([], withdrawn));
      }),
    );

  const generationOf = Effect.fnUntraced(function* (lifetime: Scope.Scope) {
    const existing = generations.get(lifetime);
    if (existing !== undefined) return existing;
    const generation: Generation = {
      bucket: makeTokenBucket(PLUGIN_NOTIFICATION_LIMITS),
      closed: false,
    };
    generations.set(lifetime, generation);
    yield* Scope.addFinalizer(
      lifetime,
      Effect.suspend(() => {
        generation.closed = true;
        return withdraw(lifetime);
      }),
    );
    return generation;
  });

  const show: PluginHostMethod = ({ registration, input, admitted, lifetime }) =>
    Effect.gen(function* () {
      if (!registration.manifest.capabilities.includes(PLUGIN_NOTIFICATIONS_CAPABILITY))
        return yield* hostError(
          `The plugin did not declare the "${PLUGIN_NOTIFICATIONS_CAPABILITY}" capability.`,
        );
      const request = yield* decodeShowInput(input).pipe(
        Effect.mapError(() =>
          hostError(
            "A notification needs a title string; body and threadId are strings; tone is neutral, info, success, warning or error.",
          ),
        ),
      );
      const title = normalizeContributionStatusText(
        request.title,
        PLUGIN_NOTIFICATION_TITLE_MAX_LENGTH,
      );
      if (title.length === 0) return yield* hostError("The notification title is empty.");
      const body =
        request.body === undefined
          ? ""
          : normalizeContributionStatusText(request.body, PLUGIN_NOTIFICATION_BODY_MAX_LENGTH);
      const generation = yield* generationOf(lifetime);
      if (!(yield* generation.bucket.take))
        return yield* hostError(
          `Too many notifications: at most ${PLUGIN_NOTIFICATION_LIMITS.burst} at once, then one every ${PLUGIN_NOTIFICATION_LIMITS.refillMillis / 1000} seconds.`,
        );
      return yield* lock.withPermit(
        Effect.gen(function* () {
          // Checked under the lock, so a withdrawal never misses a notification it races.
          if (generation.closed) return yield* STOPPED;
          yield* admitted;
          const now = yield* Clock.currentTimeMillis;
          prune(now);
          sequence += 1;
          const notification: PluginNotification = {
            sequence,
            pluginId: registration.manifest.id,
            pluginName: registration.manifest.name,
            title,
            ...(body.length === 0 ? {} : { body }),
            ...(request.tone === undefined || request.tone === "neutral"
              ? {}
              : { tone: request.tone }),
            ...(request.threadId === undefined ? {} : { threadId: request.threadId }),
            createdAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
          };
          retained = [
            ...retained,
            { notification, expiresAt: now + PLUGIN_NOTIFICATION_LIMITS.retentionMillis, lifetime },
          ].slice(-PLUGIN_NOTIFICATION_LIMITS.retained);
          yield* PubSub.publish(frames, frame([notification], []));
          return null;
        }),
      );
    });

  yield* supervisor.serveHostMethod("notifications.show", show);

  return PluginNotifications.of({
    subscribe: ({ after }) =>
      Stream.unwrap(
        lock.withPermit(
          Effect.gen(function* () {
            prune(yield* Clock.currentTimeMillis);
            const missed =
              after === undefined
                ? []
                : retained
                    .map((entry) => entry.notification)
                    .filter(
                      (notification) =>
                        after.epoch !== epoch || notification.sequence > after.sequence,
                    );
            // Subscribed under the lock: nothing is issued between the replay and the first live frame.
            const subscription = yield* PubSub.subscribe(frames);
            return Stream.concat(
              Stream.make(frame(missed, [])),
              Stream.fromSubscription(subscription),
            );
          }),
        ),
      ),
  });
});

export const layer = Layer.effect(PluginNotifications, make());
