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
const HOST = stringify({ type: "host", restricted: true });
const UNRESTRICTED = stringify({ type: "host", restricted: false });
const CONNECTED = stringify({ type: "connected" });
const DOCUMENT = "<!doctype html><p>view</p>";
const forgedCall = (id: number) =>
  fromView(stringify({ _tag: "call", id, handler: "echo", input: { forged: id } }));

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
  const mounted: string[] = [];
  let connects = 0;
  let refusals = 0;
  const page = {
    mount: (document: string) => mounted.push(document),
    post: (text: string) => Queue.offerUnsafe(toView, parse(text)),
    close: () => Deferred.doneUnsafe(pageClosed, Effect.void),
  };
  const relay = makePluginViewRelay({
    document: DOCUMENT,
    inject: (script) => new Function("window", script)({ __t3PluginViewHost: page }),
    onConnect: () => (connects += 1),
    onRefuse: () => (refusals += 1),
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
  return {
    relay,
    mounted,
    connects: () => connects,
    refusals: () => refusals,
    toView,
    pageClosed,
    calls,
    closed,
    mount,
  };
});

/** A relay whose page reported the native marker and has connected its view. */
const connectedRelay = Effect.fnUntraced(function* () {
  const harness = yield* startRelay();
  harness.relay.receive(HOST);
  harness.relay.receive(CONNECTED);
  return harness;
});

describe("makePluginViewRelay", () => {
  it.effect("sends the document only after the page's own report, and connects once", () =>
    Effect.gen(function* () {
      const harness = yield* startRelay();
      harness.relay.receive(HOST);
      expect(harness.mounted).toEqual([DOCUMENT]);
      // Nothing the page relays before the view connects is read.
      harness.relay.receive(fromView('{"_tag":"pong","n":1}'));
      harness.relay.receive("not json");
      harness.relay.receive(fromView(null));
      expect(harness.connects()).toBe(0);
      harness.relay.receive(CONNECTED);
      expect(harness.connects()).toBe(1);
      expect(harness.refusals()).toBe(0);
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

  it.effect(
    "on a build without the patch, a forged handshake never loads the view or starts a bridge",
    () =>
      Effect.gen(function* () {
        const harness = yield* startRelay();
        // The page's own first report, then what a subframe could post to the native handler.
        harness.relay.receive(UNRESTRICTED);
        harness.relay.receive(HOST);
        harness.relay.receive(CONNECTED);
        harness.relay.receive(stringify({ type: "connected", restricted: true }));
        harness.relay.receive(forgedCall(1));
        expect(harness.refusals()).toBe(1);
        expect(harness.connects()).toBe(0);
        expect(harness.mounted).toEqual([]);
        // Even a bridge attached anyway would hear nothing and say nothing.
        yield* harness.mount();
        harness.relay.receive(forgedCall(2));
        expect(harness.calls).toEqual([]);
        expect(Queue.sizeUnsafe(harness.toView)).toBe(0);
      }),
  );

  it.effect("refuses a page whose first message is not its marker report", () =>
    Effect.gen(function* () {
      for (const first of [
        CONNECTED,
        stringify({ type: "connected", restricted: true }),
        forgedCall(1),
        "not json",
      ]) {
        const harness = yield* startRelay();
        harness.relay.receive(first);
        harness.relay.receive(HOST);
        harness.relay.receive(CONNECTED);
        expect(harness.refusals()).toBe(1);
        expect(harness.connects()).toBe(0);
        expect(harness.mounted).toEqual([]);
      }
    }),
  );

  it.effect("revokes a running view on a later report or a second connect", () =>
    Effect.gen(function* () {
      for (const contradiction of [UNRESTRICTED, HOST, CONNECTED]) {
        const harness = yield* connectedRelay();
        yield* harness.mount();
        expect(yield* Queue.take(harness.toView)).toMatchObject({ _tag: "init" });
        harness.relay.receive(contradiction);
        expect(harness.refusals()).toBe(1);
        yield* Deferred.await(harness.pageClosed);
        harness.relay.receive(forgedCall(1));
        harness.relay.receive(HOST);
        expect(harness.refusals()).toBe(1);
        expect(harness.calls).toEqual([]);
        expect(Queue.sizeUnsafe(harness.toView)).toBe(0);
      }
    }),
  );
});

describe("runPluginViewRelayMount", () => {
  it.effect("introduces the view, then answers calls through the host's binding", () =>
    Effect.gen(function* () {
      const harness = yield* connectedRelay();
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
      const harness = yield* connectedRelay();
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
      harness.relay.receive(HOST);
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
