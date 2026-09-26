import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  type BrowserEngineHostError,
  type BrowserEngineHostStreamEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { expect } from "vite-plus/test";

import * as BrowserEngineHosts from "./BrowserEngineHosts.ts";
import * as PreviewManager from "./Manager.ts";

const DESKTOP = { socketId: "desktop-ws", sessionSubject: "desktop-bootstrap" };
const threadId = ThreadId.make("thread-hosts");

const reasonOf = <A>(effect: Effect.Effect<A, BrowserEngineHostError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

const registerHost = Effect.fn("test.registerHost")(function* (
  hosts: BrowserEngineHosts.BrowserEngineHosts["Service"],
  socket: BrowserEngineHosts.BrowserEngineHostSocket,
) {
  const events = yield* Queue.unbounded<BrowserEngineHostStreamEvent>();
  const stream = yield* hosts.register(socket);
  const fiber = yield* stream.pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped,
  );
  const registered = yield* Queue.take(events);
  if (registered.type !== "registered") throw new Error("expected registration first");
  return { events, fiber, hostConnectionId: registered.hostConnectionId };
});

const openClaimable = Effect.gen(function* () {
  const preview = yield* PreviewManager.PreviewManager;
  const opened = yield* preview.open({ threadId, url: "http://localhost:5173" });
  const { serverEpoch } = yield* preview.listDetails({ threadId });
  return { tabId: opened.tabId, serverEpoch, threadId };
});

it.layer(
  BrowserEngineHosts.layer.pipe(
    Layer.provideMerge(PreviewManager.layer),
    Layer.provide(NodeServices.layer),
  ),
)("BrowserEngineHosts", (it) => {
  it.effect("only the desktop bootstrap session can register or act as a host", () =>
    Effect.gen(function* () {
      const hosts = yield* BrowserEngineHosts.BrowserEngineHosts;
      const target = yield* openClaimable;
      // Pairing-link, CLI, relay and tunnel sessions carry other subjects.
      for (const sessionSubject of ["one-time-token", "cloud-connect", "cli-issued-session"]) {
        const remote = { socketId: `remote-${sessionSubject}`, sessionSubject };
        expect(yield* reasonOf(hosts.register(remote))).toBe("desktop-required");
        expect(
          yield* reasonOf(
            hosts.claim(remote, { hostConnectionId: "any", target, engineGeneration: "1" }),
          ),
        ).toBe("desktop-required");
      }
      expect(yield* hosts.hasHost).toBe(false);
    }),
  );

  it.effect("a host id is honored only on the socket that registered it", () =>
    Effect.gen(function* () {
      const hosts = yield* BrowserEngineHosts.BrowserEngineHosts;
      const target = yield* openClaimable;
      const { hostConnectionId, fiber } = yield* registerHost(hosts, DESKTOP);
      expect(yield* hosts.hasHost).toBe(true);
      // A second desktop window cannot replay the first window's host id.
      const otherWindow = { socketId: "desktop-ws-2", sessionSubject: "desktop-bootstrap" };
      expect(
        yield* reasonOf(
          hosts.claim(otherWindow, { hostConnectionId, target, engineGeneration: "1" }),
        ),
      ).toBe("host-not-registered");
      yield* hosts.claim(DESKTOP, { hostConnectionId, target, engineGeneration: "1" });

      yield* Fiber.interrupt(fiber);
      expect(yield* hosts.hasHost).toBe(false);
      // Disconnect retires the id: it cannot be used again even on its socket.
      expect(
        yield* reasonOf(hosts.claim(DESKTOP, { hostConnectionId, target, engineGeneration: "2" })),
      ).toBe("host-not-registered");
    }),
  );

  it.effect("an unanswered command resolves unknown after the bounded wait", () =>
    Effect.gen(function* () {
      const hosts = yield* BrowserEngineHosts.BrowserEngineHosts;
      const target = yield* openClaimable;
      const { hostConnectionId, events } = yield* registerHost(hosts, DESKTOP);
      const pending = yield* Effect.forkChild(
        hosts.dispatch({
          hostConnectionId,
          target,
          engineGeneration: "1",
          command: { _tag: "reload" },
        }),
      );
      const command = yield* Queue.take(events);
      if (command.type !== "command") throw new Error("expected a command event");
      yield* TestClock.adjust("10 seconds");
      expect(yield* Fiber.join(pending)).toEqual({ outcome: "unknown" });
      // A late answer has nothing left to settle and is not an error.
      yield* hosts.commandResult(DESKTOP, {
        hostConnectionId,
        commandId: command.commandId,
        result: { outcome: "applied" },
      });

      expect(
        yield* hosts.dispatch({
          hostConnectionId: "never-registered",
          target,
          engineGeneration: "1",
          command: { _tag: "back" },
        }),
      ).toEqual({ outcome: "unknown" });
    }),
  );
});
