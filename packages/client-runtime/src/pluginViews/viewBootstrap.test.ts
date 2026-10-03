import { describe, expect, it } from "@effect/vitest";
import {
  PLUGIN_VIEW_CONNECT_MESSAGE,
  PLUGIN_VIEW_MAX_IN_FLIGHT_CALLS,
  PLUGIN_VIEW_MESSAGE_BURST,
  PLUGIN_VIEW_READY_MESSAGE,
  type PluginViewHostMessage,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { makePluginViewBridge } from "./viewBridge.ts";
import { PLUGIN_VIEW_BOOTSTRAP_SOURCE } from "./viewDocument.ts";

interface ViewApi {
  readonly ready: Promise<unknown>;
  readonly call: (
    handler: unknown,
    input?: unknown,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<unknown>;
}

const parse = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/** The code a refused `t3View.call` carries, or `ok` when it resolved. */
const outcome = (result: PromiseSettledResult<unknown>) =>
  result.status === "fulfilled"
    ? "ok"
    : String((result.reason as { readonly code?: unknown }).code);

/**
 * Runs the real bootstrap against a fake frame window and connects its port
 * to a real bridge. Port messages are delivered asynchronously, as a
 * MessagePort does. `answer` decides each call the host makes.
 */
const mountBootstrap = Effect.fn("mountBootstrap")(function* (
  answer: (handler: string, input: Schema.Json) => Effect.Effect<Schema.Json> = (_handler, input) =>
    Effect.succeed(input),
) {
  const toHost: Array<string> = [];
  const toView: Array<PluginViewHostMessage> = [];
  const calls: Array<string> = [];
  // Resolves once the host has posted or called enough; re-checked on every event.
  const waiters: Array<() => void> = [];
  const notify = () => waiters.splice(0).forEach((check) => check());
  const until = (done: () => boolean) =>
    Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          const check = () => (done() ? resolve() : waiters.push(check));
          check();
        }),
    );
  const listeners: Array<(event: unknown) => void> = [];
  const hostWindow = {
    postMessage: (data: { readonly type: string }) => toHost.push(data.type),
  };
  const frameWindow: { t3View?: ViewApi } & Record<string, unknown> = {
    parent: { parent: hostWindow },
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      listeners.push(listener),
  };
  const viewPort = {
    onmessage: null as ((event: { readonly data: string }) => void) | null,
    postMessage: (text: string) => queueMicrotask(() => bridge.receive(text, 0)),
  };
  new Function("window", "console", PLUGIN_VIEW_BOOTSTRAP_SOURCE)(frameWindow, {
    warn: () => undefined,
  });
  expect(toHost).toEqual([PLUGIN_VIEW_READY_MESSAGE]);

  const scope = yield* Scope.make();
  const bridge = yield* makePluginViewBridge({
    view: { pluginId: "acme.board", viewId: "board", title: "Board" },
    port: {
      post: (text) => {
        toView.push(parse(text) as PluginViewHostMessage);
        notify();
        queueMicrotask(() => viewPort.onmessage?.({ data: text }));
      },
      close: () => undefined,
    },
    call: (handler, input) => {
      calls.push(handler);
      notify();
      return answer(handler, input);
    },
    onClose: () => undefined,
  }).pipe(Scope.provide(scope));
  for (const listener of listeners)
    listener({
      data: { type: PLUGIN_VIEW_CONNECT_MESSAGE },
      source: hostWindow,
      ports: [viewPort],
      stopImmediatePropagation: () => undefined,
    });
  const t3View = frameWindow.t3View!;
  yield* Effect.promise(() => t3View.ready);
  return { t3View, toView, calls, until };
});

describe("plugin view bootstrap with the host bridge", () => {
  it.effect("settles a call burst past the rate budget, refusing only the excess", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const { t3View, toView, until } = yield* mountBootstrap((_handler, input) =>
        Deferred.await(gate).pipe(Effect.as(input)),
      );
      const burst = Array.from({ length: PLUGIN_VIEW_MESSAGE_BURST + 1 }, (_, index) =>
        t3View.call("echo", index),
      );
      const settled = Effect.promise(() => Promise.allSettled(burst));
      // The last call is refused while the admitted ones still wait on the plugin.
      yield* until(() => toView.some((message) => message._tag === "violation"));
      yield* Deferred.succeed(gate, undefined);
      const outcomes = (yield* settled).map(outcome);
      expect(outcomes.filter((code) => code === "rate")).toHaveLength(1);
      expect(outcomes.filter((code) => code === "ok")).toHaveLength(
        PLUGIN_VIEW_MAX_IN_FLIGHT_CALLS,
      );
      expect(outcomes.filter((code) => code === "busy")).toHaveLength(
        PLUGIN_VIEW_MESSAGE_BURST - PLUGIN_VIEW_MAX_IN_FLIGHT_CALLS,
      );
      expect(toView.filter((message) => message._tag === "violation")).toEqual([
        { _tag: "violation", reason: "rate" },
      ]);
    }),
  );

  it.effect("rejects calls the host would refuse without sending them", () =>
    Effect.gen(function* () {
      const { t3View, toView, calls } = yield* mountBootstrap();
      let deep: unknown = null;
      for (let depth = 0; depth < 40; depth += 1) deep = [deep];
      const outcomes = (yield* Effect.promise(() =>
        Promise.allSettled([
          t3View.call("echo", deep),
          t3View.call("view:other:echo", null),
          t3View.call(7, null),
          t3View.call("echo", "x".repeat(64 * 1024)),
          t3View.call("echo", { ok: true }),
        ]),
      )).map(outcome);
      expect(outcomes).toEqual(["too-deep", "invalid", "invalid", "too-large", "ok"]);
      expect(calls).toEqual(["echo"]);
      expect(toView.filter((message) => message._tag === "violation")).toEqual([]);
    }),
  );

  it.effect("rejects input that JSON leaves out instead of sending a call without it", () =>
    Effect.gen(function* () {
      const { t3View, toView, calls } = yield* mountBootstrap();
      const outcomes = (yield* Effect.promise(() =>
        Promise.allSettled([
          t3View.call("echo", () => undefined),
          t3View.call("echo", Symbol("input")),
          t3View.call("echo", { toJSON: () => undefined }),
        ]),
      )).map(outcome);
      expect(outcomes).toEqual(["invalid", "invalid", "invalid"]);
      // Omitted input still means null.
      expect(yield* Effect.promise(() => t3View.call("echo"))).toBeNull();
      expect(calls).toEqual(["echo"]);
      expect(toView.filter((message) => message._tag === "violation")).toEqual([]);
    }),
  );

  it.effect("rejects an aborted call at once and cancels it on the host", () =>
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>();
      const { t3View, calls, until } = yield* mountBootstrap(() =>
        Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
      );
      const controller = new AbortController();
      const pending = t3View.call("hang", null, { signal: controller.signal });
      const settled = Effect.promise(() => Promise.allSettled([pending]));
      yield* until(() => calls.length === 1);
      controller.abort();
      expect((yield* settled).map(outcome)).toEqual(["cancelled"]);
      yield* Deferred.await(interrupted);
    }),
  );
});
