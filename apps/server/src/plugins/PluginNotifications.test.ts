import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { type PluginNotificationFrame, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { PluginRegistration } from "./PluginManifestLoader.ts";
import * as PluginNotifications from "./PluginNotifications.ts";
import { PluginSupervisor } from "./PluginSupervisor.ts";
import { recordingSupervisor, registrationFor } from "./testFixtures/hostCalls.ts";

const start = Effect.fn("start")(function* () {
  const { supervisor, call } = recordingSupervisor();
  const notifications = yield* PluginNotifications.make().pipe(
    Effect.provideService(PluginSupervisor, supervisor),
  );
  const show = (registration: PluginRegistration, lifetime: Scope.Scope, input: Schema.Json) =>
    call("notifications.show", registration, lifetime, input);
  /** Sends one notification from its own process, so no rate limit applies. */
  const showOnce = (title: string) =>
    Effect.flatMap(Scope.make(), (lifetime) =>
      show(registrationFor(`acme.${title}`), lifetime, { title }),
    );
  return { notifications, show, showOnce };
});

/** A subscriber; `next` waits for its next frame, the receipt for each change. */
const follow = Effect.fn("follow")(function* (
  notifications: PluginNotifications.PluginNotifications["Service"],
) {
  const pull = yield* Stream.toPull(notifications.subscribe);
  const buffered: Array<PluginNotificationFrame> = [];
  const next = Effect.gen(function* () {
    while (buffered.length === 0) buffered.push(...(yield* pull));
    return buffered.shift()!;
  });
  return { next };
});

const titles = (frame: PluginNotificationFrame) =>
  frame.notifications.map((notification) => notification.title);

it.layer(NodeServices.layer)("PluginNotifications", (it) => {
  describe("retained set", () => {
    it.effect("sends the retained set first, then the whole set after each change", () =>
      Effect.gen(function* () {
        const { notifications, show, showOnce } = yield* start();
        yield* showOnce("before");
        const live = yield* follow(notifications);
        const first = yield* live.next;
        assert.deepStrictEqual(titles(first), ["before"]);

        yield* show(registrationFor("acme.notifier"), yield* Scope.make(), {
          title: "a",
          threadId: "thread-1",
          tone: "success",
        });
        const next = yield* live.next;
        assert.strictEqual(next.epoch, first.epoch);
        assert.deepStrictEqual(titles(next), ["before", "a"]);
        assert.deepInclude(next.notifications[1], {
          sequence: 2,
          pluginId: "acme.notifier",
          pluginName: "Plugin acme.notifier",
          title: "a",
          tone: "success",
          threadId: ThreadId.make("thread-1"),
        });
      }).pipe(Effect.scoped),
    );

    it.effect("starts a new epoch with nothing retained after a restart", () =>
      Effect.gen(function* () {
        const before = yield* start();
        yield* before.showOnce("old");
        const beforeFrame = yield* (yield* follow(before.notifications)).next;
        const after = yield* start();
        const afterFrame = yield* (yield* follow(after.notifications)).next;
        assert.notStrictEqual(afterFrame.epoch, beforeFrame.epoch);
        assert.deepStrictEqual(afterFrame.notifications, []);
      }).pipe(Effect.scoped),
    );

    it.effect("keeps the newest 20 and drops each one live as it expires", () =>
      Effect.gen(function* () {
        const { notifications, showOnce } = yield* start();
        const live = yield* follow(notifications);
        yield* live.next;
        yield* showOnce("n1");
        let last = yield* live.next;
        yield* TestClock.adjust("30 seconds");
        for (let index = 2; index <= 21; index++) {
          yield* showOnce(`n${index}`);
          last = yield* live.next;
        }
        // The 21st evicted the oldest; clients close it on this frame.
        assert.deepStrictEqual(
          titles(last),
          Array.from({ length: 20 }, (_, index) => `n${index + 2}`),
        );

        // Two minutes after they were sent, the rest expire together, without any new traffic.
        yield* TestClock.adjust("2 minutes");
        assert.deepStrictEqual(titles(yield* live.next), []);
      }).pipe(Effect.scoped),
    );
  });

  describe("process lifetime", () => {
    it.effect("withdraws a stopped process's notifications from every subscriber", () =>
      Effect.gen(function* () {
        const { notifications, show } = yield* start();
        const stopped = yield* Scope.make();
        yield* show(registrationFor("acme.a"), stopped, { title: "from a" });
        yield* show(registrationFor("acme.b"), yield* Scope.make(), { title: "from b" });
        const first = yield* follow(notifications);
        const second = yield* follow(notifications);
        assert.deepStrictEqual(titles(yield* first.next), ["from a", "from b"]);
        assert.deepStrictEqual(titles(yield* second.next), ["from a", "from b"]);

        yield* Scope.close(stopped, Exit.void);
        assert.deepStrictEqual(titles(yield* first.next), ["from b"]);
        assert.deepStrictEqual(titles(yield* second.next), ["from b"]);

        const error = yield* show(registrationFor("acme.a"), stopped, { title: "late" }).pipe(
          Effect.flip,
        );
        assert.strictEqual(error.message, "The plugin was stopped.");
        // A client that was away during the disable reconnects to the set without it.
        assert.deepStrictEqual(titles(yield* (yield* follow(notifications)).next), ["from b"]);
      }).pipe(Effect.scoped),
    );
  });

  describe("bounds", () => {
    it.effect("rate-limits each process: 5 at once, then one every 5 seconds", () =>
      Effect.gen(function* () {
        const { show } = yield* start();
        const lifetime = yield* Scope.make();
        const plugin = registrationFor("acme.chatty");
        for (let index = 0; index < 5; index++)
          yield* show(plugin, lifetime, { title: `n${index}` });
        const refused = yield* show(plugin, lifetime, { title: "too many" }).pipe(Effect.flip);
        assert.include(refused.message, "Too many notifications");

        yield* TestClock.adjust("5 seconds");
        yield* show(plugin, lifetime, { title: "allowed again" });
        assert.include(
          (yield* show(plugin, lifetime, { title: "and refused" }).pipe(Effect.flip)).message,
          "Too many notifications",
        );
        // Another plugin is unaffected.
        yield* show(registrationFor("acme.quiet"), yield* Scope.make(), { title: "fine" });
      }).pipe(Effect.scoped),
    );

    it.effect("normalizes text to the wire bounds and refuses malformed requests", () =>
      Effect.gen(function* () {
        const { notifications, show } = yield* start();
        const lifetime = yield* Scope.make();
        const plugin = registrationFor("acme.text");
        const live = yield* follow(notifications);
        yield* live.next;
        yield* show(plugin, lifetime, {
          title: "\u001b[31mBuild\u001b[0m\nfailed  twice",
          body: "x".repeat(300),
          tone: "neutral",
        });
        const notification = (yield* live.next).notifications[0];
        assert.strictEqual(notification?.title, "Build failed twice");
        assert.strictEqual(notification?.body?.length, 240);
        assert.isTrue(notification?.body?.endsWith("…"));
        assert.isUndefined(notification?.tone);

        for (const input of [{ title: " \n " }, { title: 1 }, { title: "x", tone: "loud" }]) {
          const error = yield* show(plugin, lifetime, input).pipe(Effect.flip);
          assert.match(error.message, /title|tone/);
        }
        const undeclared = yield* show(registrationFor("acme.mute", ["status"]), lifetime, {
          title: "x",
        }).pipe(Effect.flip);
        assert.strictEqual(
          undeclared.message,
          'The plugin did not declare the "notifications" capability.',
        );
      }).pipe(Effect.scoped),
    );
  });
});
