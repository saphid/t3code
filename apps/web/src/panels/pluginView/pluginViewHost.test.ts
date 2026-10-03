import { describe, expect, it } from "@effect/vitest";
import {
  PLUGIN_VIEW_CONNECT_MESSAGE,
  PLUGIN_VIEW_MAX_VIOLATIONS,
  PLUGIN_VIEW_READY_MESSAGE,
  PluginInstallationId,
  type PluginView,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

import { awaitPluginViewReady, runPluginViewMount } from "./pluginViewHost";

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

/** A host window that records its one message listener, and a view window that records posts. */
function handshakeFixture() {
  let listener: ((event: MessageEvent) => void) | null = null;
  const host = {
    addEventListener: (_type: string, next: (event: MessageEvent) => void) => {
      listener = next;
    },
    removeEventListener: (_type: string, next: (event: MessageEvent) => void) => {
      if (listener === next) listener = null;
    },
  } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
  const viewWindow = { postMessage: vi.fn() };
  const otherWindow = { postMessage: vi.fn() };
  const ports: MessagePort[] = [];
  const stop = awaitPluginViewReady({
    host,
    viewWindow: () => viewWindow,
    onConnect: (port) => ports.push(port),
  });
  const dispatch = (source: unknown, data: unknown) =>
    listener?.({ source, data } as unknown as MessageEvent);
  return { viewWindow, otherWindow, ports, stop, dispatch, listening: () => listener !== null };
}

describe("awaitPluginViewReady", () => {
  it("hands the view's window exactly one port, once", () => {
    const fixture = handshakeFixture();
    fixture.dispatch(fixture.viewWindow, { type: PLUGIN_VIEW_READY_MESSAGE });
    expect(fixture.ports).toHaveLength(1);
    expect(fixture.viewWindow.postMessage).toHaveBeenCalledTimes(1);
    const [message, target, transfer] = fixture.viewWindow.postMessage.mock.calls[0]!;
    expect(message).toEqual({ type: PLUGIN_VIEW_CONNECT_MESSAGE });
    expect(target).toBe("*");
    expect(transfer).toHaveLength(1);
    // Connected: the host reads no further window messages, so a second ready gets nothing.
    expect(fixture.listening()).toBe(false);
    fixture.dispatch(fixture.viewWindow, { type: PLUGIN_VIEW_READY_MESSAGE });
    expect(fixture.ports).toHaveLength(1);
    for (const port of fixture.ports) port.close();
    for (const call of fixture.viewWindow.postMessage.mock.calls)
      for (const port of call[2] as MessagePort[]) port.close();
  });

  it("ignores other windows, other messages, and everything after it stops", () => {
    const fixture = handshakeFixture();
    fixture.dispatch(fixture.otherWindow, { type: PLUGIN_VIEW_READY_MESSAGE });
    fixture.dispatch(null, { type: PLUGIN_VIEW_READY_MESSAGE });
    fixture.dispatch(fixture.viewWindow, { type: "something-else" });
    fixture.dispatch(fixture.viewWindow, PLUGIN_VIEW_READY_MESSAGE);
    expect(fixture.ports).toHaveLength(0);
    expect(fixture.otherWindow.postMessage).not.toHaveBeenCalled();
    fixture.stop();
    fixture.dispatch(fixture.viewWindow, { type: PLUGIN_VIEW_READY_MESSAGE });
    expect(fixture.ports).toHaveLength(0);
    expect(fixture.viewWindow.postMessage).not.toHaveBeenCalled();
  });
});

/**
 * A mount over a real MessageChannel. The test plays the view on `view`,
 * collecting what the host sends; `answer` decides each bound call.
 */
const startMount = Effect.fn("startMount")(function* (
  answer: (handler: string, input: Schema.Json) => Effect.Effect<Schema.Json> = (_h, input) =>
    Effect.succeed({ echo: input }),
) {
  const channel = new MessageChannel();
  const view = channel.port2;
  const received: unknown[] = [];
  const waiters: Array<{ count: number; done: Deferred.Deferred<void> }> = [];
  view.addEventListener("message", (event) => {
    received.push(parse(event.data));
    for (const waiter of waiters)
      if (received.length >= waiter.count) Deferred.doneUnsafe(waiter.done, Effect.void);
  });
  view.start();
  const receivedCount = (count: number) =>
    Effect.suspend(() => {
      const done = Deferred.makeUnsafe<void>();
      if (received.length >= count) return Effect.void;
      waiters.push({ count, done });
      return Deferred.await(done);
    });
  const closed = yield* Deferred.make<string>();
  const closes: string[] = [];
  const calls: Array<{ handler: string; input: Schema.Json }> = [];
  const fiber = yield* runPluginViewMount({
    port: channel.port1,
    view: board,
    call: (handler, input) => {
      calls.push({ handler, input });
      return answer(handler, input);
    },
    onClose: (reason) => {
      closes.push(reason);
      Deferred.doneUnsafe(closed, Effect.succeed(reason));
    },
  }).pipe(Effect.scoped, Effect.forkChild);
  return { view, received, receivedCount, closed, closes, calls, fiber };
});

describe("runPluginViewMount", () => {
  it.effect("introduces the view, then answers calls through the host's binding", () =>
    Effect.gen(function* () {
      const mount = yield* startMount();
      yield* mount.receivedCount(1);
      expect(mount.received[0]).toEqual({
        _tag: "init",
        pluginId: board.pluginId,
        viewId: board.viewId,
        title: board.title,
      });
      mount.view.postMessage(
        stringify({ _tag: "call", id: 1, handler: "echo", input: { from: "board" } }),
        [],
      );
      yield* mount.receivedCount(2);
      expect(mount.calls).toEqual([{ handler: "echo", input: { from: "board" } }]);
      expect(mount.received[1]).toEqual({
        _tag: "result",
        id: 1,
        value: { echo: { from: "board" } },
      });
      yield* Fiber.interrupt(mount.fiber);
      expect(mount.closes).toEqual(["closed"]);
      mount.view.close();
    }),
  );

  it.effect("ends the mount on its eighth violation, counting transferred ports", () =>
    Effect.gen(function* () {
      const mount = yield* startMount();
      yield* mount.receivedCount(1);
      const extra = new MessageChannel();
      mount.view.postMessage(stringify({ _tag: "pong", n: 0 }), [extra.port1]);
      yield* mount.receivedCount(2);
      expect(mount.received[1]).toEqual({ _tag: "violation", reason: "transfer" });
      for (let index = 1; index < PLUGIN_VIEW_MAX_VIOLATIONS; index += 1)
        mount.view.postMessage({ not: "text" }, []);
      expect(yield* Deferred.await(mount.closed)).toBe("violations");
      // The mount ended on its own; interrupting it later reports nothing more.
      yield* Fiber.interrupt(mount.fiber);
      expect(mount.closes).toEqual(["violations"]);
      expect(mount.calls).toEqual([]);
      extra.port2.close();
      mount.view.close();
    }),
  );

  it.effect("drops a call's answer once the host tears the mount down", () =>
    Effect.gen(function* () {
      const called = yield* Deferred.make<void>();
      const release = yield* Deferred.make<Schema.Json>();
      const mount = yield* startMount(() =>
        Deferred.succeed(called, undefined).pipe(Effect.andThen(Deferred.await(release))),
      );
      yield* mount.receivedCount(1);
      mount.view.postMessage(stringify({ _tag: "call", id: 1, handler: "hang", input: null }), []);
      yield* Deferred.await(called);
      yield* Fiber.interrupt(mount.fiber);
      yield* Deferred.succeed(release, "late");
      expect(mount.closes).toEqual(["closed"]);
      expect(mount.received).toHaveLength(1);
      mount.view.close();
    }),
  );
});
