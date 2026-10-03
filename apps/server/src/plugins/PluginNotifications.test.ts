import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type {
  PluginNotificationFrame,
  PluginNotificationsSubscribeInput,
} from "@t3tools/contracts";
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
  return { notifications, show };
});

/** Pulls frames from a subscription until `count` have arrived. */
const subscribe = Effect.fn("subscribe")(function* (
  notifications: PluginNotifications.PluginNotifications["Service"],
  input: PluginNotificationsSubscribeInput,
) {
  const pull = yield* Stream.toPull(notifications.subscribe(input));
  const buffered: Array<PluginNotificationFrame> = [];
  const next = Effect.fn("next")(function* (count = 1) {
    while (buffered.length < count) buffered.push(...(yield* pull));
    return buffered.splice(0, count);
  });
  return { next };
});

const titles = (frame: PluginNotificationFrame | undefined) =>
  frame?.notifications.map((notification) => notification.title);

it.layer(NodeServices.layer)("PluginNotifications", (it) => {
  describe("replay", () => {
    it.effect("starts live without a cursor and replays only what a reconnect missed", () =>
      Effect.gen(function* () {
        const { notifications, show } = yield* start();
        const lifetime = yield* Scope.make();
        const plugin = registrationFor("acme.notifier");
        yield* show(plugin, lifetime, { title: "before anyone listened" });

        const live = yield* subscribe(notifications, {});
        const [first] = yield* live.next();
        assert.deepStrictEqual(first?.notifications, []);
        assert.strictEqual(first?.sequence, 1);

        yield* show(plugin, lifetime, { title: "a", threadId: "thread-1", tone: "success" });
        yield* show(plugin, lifetime, { title: "b" });
        const [a, b] = yield* live.next(2);
        assert.deepInclude(a?.notifications[0], {
          sequence: 2,
          pluginId: "acme.notifier",
          pluginName: "Plugin acme.notifier",
          title: "a",
          tone: "success",
          threadId: "thread-1",
        });
        assert.deepStrictEqual(titles(b), ["b"]);

        // A client that saw `a` reconnects: only `b` is replayed, once.
        const reconnect = yield* subscribe(notifications, {
          after: { epoch: a!.epoch, sequence: a!.sequence },
        });
        const [replay] = yield* reconnect.next();
        assert.deepStrictEqual(titles(replay), ["b"]);
        assert.strictEqual(replay?.sequence, 3);

        // Up to date: nothing again.
        const current = yield* subscribe(notifications, {
          after: { epoch: b!.epoch, sequence: b!.sequence },
        });
        assert.deepStrictEqual(titles((yield* current.next())[0]), []);

        // A cursor from before a server restart replays all of this run's retained ones.
        const restarted = yield* subscribe(notifications, {
          after: { epoch: "previous-run", sequence: 99 },
        });
        assert.deepStrictEqual(titles((yield* restarted.next())[0]), [
          "before anyone listened",
          "a",
          "b",
        ]);
      }),
    );

    it.effect("retains at most 20 notifications for two minutes", () =>
      Effect.gen(function* () {
        const { notifications, show } = yield* start();
        const missed = { epoch: "previous-run", sequence: 0 };
        // Each process has its own rate limit, so 25 one-shot processes send 25.
        for (let index = 1; index <= 25; index++)
          yield* show(registrationFor(`acme.p${index}`), yield* Scope.make(), {
            title: `n${index}`,
          });
        const [replay] = yield* (yield* subscribe(notifications, { after: missed })).next();
        assert.deepStrictEqual(
          titles(replay),
          Array.from({ length: 20 }, (_, index) => `n${index + 6}`),
        );

        yield* TestClock.adjust("2 minutes");
        const [expired] = yield* (yield* subscribe(notifications, { after: missed })).next();
        assert.deepStrictEqual(titles(expired), []);
        assert.strictEqual(expired?.sequence, 25);
      }),
    );
  });

  describe("process lifetime", () => {
    it.effect("withdraws a stopped process's notifications and refuses it afterwards", () =>
      Effect.gen(function* () {
        const { notifications, show } = yield* start();
        const stopped = yield* Scope.make();
        const other = yield* Scope.make();
        yield* show(registrationFor("acme.a"), stopped, { title: "from a" });
        yield* show(registrationFor("acme.b"), other, { title: "from b" });
        const live = yield* subscribe(notifications, {});
        yield* live.next();

        yield* Scope.close(stopped, Exit.void);
        const [withdrawal] = yield* live.next();
        assert.deepStrictEqual(withdrawal?.withdrawn, [1]);
        assert.deepStrictEqual(withdrawal?.notifications, []);

        const error = yield* show(registrationFor("acme.a"), stopped, { title: "late" }).pipe(
          Effect.flip,
        );
        assert.strictEqual(error.message, "The plugin was stopped.");
        const [replay] = yield* (yield* subscribe(notifications, {
          after: { epoch: withdrawal!.epoch, sequence: 0 },
        })).next();
        assert.deepStrictEqual(titles(replay), ["from b"]);
      }),
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
      }),
    );

    it.effect("normalizes text to the wire bounds and refuses malformed requests", () =>
      Effect.gen(function* () {
        const { notifications, show } = yield* start();
        const lifetime = yield* Scope.make();
        const plugin = registrationFor("acme.text");
        const live = yield* subscribe(notifications, {});
        yield* live.next();
        yield* show(plugin, lifetime, {
          title: "\u001b[31mBuild\u001b[0m\nfailed  twice",
          body: "x".repeat(300),
          tone: "neutral",
        });
        const notification = (yield* live.next())[0]?.notifications[0];
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
      }),
    );
  });
});
