import { describe, expect, it } from "@effect/vitest";
import type { PluginViewCloseReason } from "@t3tools/client-runtime/plugin-views/bridge";
import {
  PLUGIN_VIEW_MAX_VIOLATIONS,
  PLUGIN_VIEW_MESSAGE_MAX_BYTES,
  PluginInstallationId,
  type PluginView,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";

import { makePluginViewRelay, runPluginViewRelayMount } from "./pluginViewNativeMount";

const board: PluginView = {
  installationId: PluginInstallationId.make("installation-1"),
  generation: 1,
  pluginId: "test.views-board",
  pluginName: "Board",
  viewId: "board",
  title: "Board",
  placement: "side-panel",
};
const parse = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const stringify = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** What the host page sends native when the view posts `text` on its port. */
const fromView = (text: string | null, ports = 0) => stringify({ type: "message", text, ports });
const CONNECTED = stringify({ type: "connected", restricted: true });

/**
 * A relay whose injected scripts run against a stand-in page, so the test
 * sees exactly what reaches the view's port and whether the page was closed.
 */
const startRelay = Effect.fnUntraced(function* (
  answer: (handler: string, input: Schema.Json) => Effect.Effect<Schema.Json> = (_handler, input) =>
    Effect.succeed({ echo: input }),
) {
  const toView = yield* Queue.unbounded<unknown>();
  const pageClosed = yield* Deferred.make<void>();
  const connects: boolean[] = [];
  const page = {
    post: (text: string) => Queue.offerUnsafe(toView, parse(text)),
    close: () => Deferred.doneUnsafe(pageClosed, Effect.void),
  };
  const relay = makePluginViewRelay({
    inject: (script) => new Function("window", script)({ __t3PluginViewHost: page }),
    onConnect: (restricted) => connects.push(restricted),
  });
  const calls: Array<{ handler: string; input: Schema.Json }> = [];
  const closed = yield* Deferred.make<PluginViewCloseReason>();
  const mount = () =>
    runPluginViewRelayMount({
      relay,
      view: board,
      call: (handler, input) => {
        calls.push({ handler, input });
        return answer(handler, input);
      },
      onClose: (reason) => Deferred.doneUnsafe(closed, Effect.succeed(reason)),
    }).pipe(Effect.scoped, Effect.forkChild);
  return { relay, connects, toView, pageClosed, calls, closed, mount };
});

describe("makePluginViewRelay", () => {
  it.effect("reads nothing before the view connects, and connects once", () =>
    Effect.gen(function* () {
      const harness = yield* startRelay();
      harness.relay.receive(fromView('{"_tag":"pong","n":1}'));
      harness.relay.receive("not json");
      harness.relay.receive(stringify({ type: "connected" }));
      expect(harness.connects).toEqual([]);
      harness.relay.receive(fromView(null));
      harness.relay.receive(stringify({ type: "connected", restricted: false }));
      harness.relay.receive(CONNECTED);
      expect(harness.connects).toEqual([false]);
      // What the page relayed before connecting never reached the bridge.
      yield* harness.mount();
      expect(yield* Queue.take(harness.toView)).toMatchObject({ _tag: "init" });
      harness.relay.receive(
        fromView(stringify({ _tag: "call", id: 1, handler: "echo", input: 1 })),
      );
      expect(yield* Queue.take(harness.toView)).toEqual({
        _tag: "result",
        id: 1,
        value: { echo: 1 },
      });
    }),
  );
});

describe("runPluginViewRelayMount", () => {
  it.effect("introduces the view, then answers calls through the host's binding", () =>
    Effect.gen(function* () {
      const harness = yield* startRelay();
      harness.relay.receive(CONNECTED);
      // A call the view made before the bridge started is answered after `init`.
      harness.relay.receive(
        fromView(stringify({ _tag: "call", id: 1, handler: "echo", input: { from: "board" } })),
      );
      const fiber = yield* harness.mount();
      expect(yield* Queue.take(harness.toView)).toEqual({
        _tag: "init",
        pluginId: board.pluginId,
        viewId: board.viewId,
        title: board.title,
      });
      expect(yield* Queue.take(harness.toView)).toEqual({
        _tag: "result",
        id: 1,
        value: { echo: { from: "board" } },
      });
      // An extra field never names another target.
      harness.relay.receive(
        fromView(
          stringify({ _tag: "call", id: 2, handler: "echo", input: 2, installationId: "other" }),
        ),
      );
      expect(yield* Queue.take(harness.toView)).toEqual({
        _tag: "result",
        id: 2,
        value: { echo: 2 },
      });
      expect(harness.calls).toEqual([
        { handler: "echo", input: { from: "board" } },
        { handler: "echo", input: 2 },
      ]);
      yield* Fiber.interrupt(fiber);
      expect(yield* Deferred.await(harness.closed)).toBe("closed");
      yield* Deferred.await(harness.pageClosed);
    }),
  );

  it.effect("ends the mount and closes the page on the eighth violation", () =>
    Effect.gen(function* () {
      const harness = yield* startRelay();
      harness.relay.receive(CONNECTED);
      yield* harness.mount();
      expect(yield* Queue.take(harness.toView)).toMatchObject({ _tag: "init" });
      harness.relay.receive(fromView('{"_tag":"pong","n":0}', 1));
      expect(yield* Queue.take(harness.toView)).toEqual({ _tag: "violation", reason: "transfer" });
      harness.relay.receive(fromView("x".repeat(PLUGIN_VIEW_MESSAGE_MAX_BYTES + 1)));
      expect(yield* Queue.take(harness.toView)).toEqual({ _tag: "violation", reason: "too-large" });
      for (let index = 2; index < PLUGIN_VIEW_MAX_VIOLATIONS; index += 1)
        harness.relay.receive(fromView(null));
      expect(yield* Deferred.await(harness.closed)).toBe("violations");
      yield* Deferred.await(harness.pageClosed);
      expect(harness.calls).toEqual([]);
    }),
  );

  it.effect("drops a call's answer once the host tears the mount down", () =>
    Effect.gen(function* () {
      const called = yield* Deferred.make<void>();
      const release = yield* Deferred.make<Schema.Json>();
      const harness = yield* startRelay(() =>
        Deferred.succeed(called, undefined).pipe(Effect.andThen(Deferred.await(release))),
      );
      harness.relay.receive(CONNECTED);
      const fiber = yield* harness.mount();
      expect(yield* Queue.take(harness.toView)).toMatchObject({ _tag: "init" });
      harness.relay.receive(
        fromView(stringify({ _tag: "call", id: 1, handler: "hang", input: null })),
      );
      yield* Deferred.await(called);
      yield* Fiber.interrupt(fiber);
      yield* Deferred.succeed(release, "late");
      expect(yield* Deferred.await(harness.closed)).toBe("closed");
      expect(Queue.sizeUnsafe(harness.toView)).toBe(0);
    }),
  );
});
