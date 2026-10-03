import {
  EnvironmentId,
  type PluginNotificationFrame,
  type PluginNotificationsSubscribeInput,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  applyPluginNotificationFrame,
  createPluginNotificationEnvironmentAtoms,
  EMPTY_PLUGIN_NOTIFICATION_FEED,
  type PluginNotificationFeed,
  pluginNotificationChanges,
  pluginNotificationDescription,
} from "./pluginNotifications.ts";

const notification = (sequence: number, title = `n${sequence}`) => ({
  sequence,
  pluginId: "acme.notifier",
  pluginName: "Notifier",
  title,
  createdAt: "2026-10-04T00:00:00.000Z",
});

const frame = (
  epoch: string,
  sequence: number,
  sequences: ReadonlyArray<number>,
  withdrawn: ReadonlyArray<number> = [],
): PluginNotificationFrame => ({
  epoch,
  sequence,
  notifications: sequences.map((each) => notification(each)),
  withdrawn,
});

const config = (supported: boolean) =>
  ({
    environment: {
      serverVersion: "0.0.1",
      capabilities: supported ? { pluginNotifications: true } : {},
    },
  }) as ServerConfig;

/** One environment whose server pushes frames from a queue and records each subscription's input. */
const makeEnvironment = Effect.fn("makeEnvironment")(function* (id: string, supported: boolean) {
  const environmentId = EnvironmentId.make(id);
  const inputs: Array<PluginNotificationsSubscribeInput> = [];
  const makeSession = Effect.fn("makeSession")(function* () {
    const frames = yield* Queue.unbounded<PluginNotificationFrame>();
    const client = {
      [WS_METHODS.pluginsNotificationsSubscribe]: (input: PluginNotificationsSubscribeInput) => {
        inputs.push(input);
        return Stream.fromQueue(frames);
      },
    } as unknown as WsRpcProtocolClient;
    const session: RpcSession = {
      client,
      initialConfig: Effect.succeed(config(supported)),
      subscribeServerConfig: () => Stream.never,
      ready: Effect.void,
      probe: Effect.void,
      closed: Effect.never,
    };
    return { session, push: (next: PluginNotificationFrame) => Queue.offer(frames, next) };
  });
  const first = yield* makeSession();
  const session = yield* SubscriptionRef.make(Option.some(first.session));
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: new PrimaryConnectionTarget({
      environmentId,
      label: id,
      httpBaseUrl: `https://${id}.example.test`,
      wsBaseUrl: `wss://${id}.example.test`,
    }),
    state: yield* SubscriptionRef.make<SupervisorConnectionState>({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected",
    }),
    session,
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  return {
    environmentId,
    supervisor,
    config: Atom.make(config(supported)),
    inputs,
    push: first.push,
    /** Swaps in a new connection, as a reconnect does, and returns its push. */
    reconnect: Effect.gen(function* () {
      const next = yield* makeSession();
      yield* SubscriptionRef.set(session, Option.some(next.session));
      return next.push;
    }),
  };
});

const makeHarness = Effect.fn("makeHarness")(function* () {
  const environments = [
    yield* makeEnvironment("env-a", true),
    yield* makeEnvironment("env-old", false),
  ] as const;
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]));
  const supervisorFor = (environmentId: EnvironmentId) => byId.get(environmentId)!.supervisor;
  const registryService = EnvironmentRegistry.EnvironmentRegistry.of({
    run: (environmentId, effect) =>
      Effect.provideService(
        effect,
        EnvironmentSupervisor.EnvironmentSupervisor,
        supervisorFor(environmentId),
      ),
    followStream: (environmentId, stream) =>
      Stream.provideService(
        stream,
        EnvironmentSupervisor.EnvironmentSupervisor,
        supervisorFor(environmentId),
      ),
  } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
  const runtime = Atom.runtime(
    Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registryService),
  );
  const atoms = createPluginNotificationEnvironmentAtoms(runtime, {
    configValueAtom: (environmentId) => byId.get(environmentId)!.config,
  });
  const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
    Effect.sync(() => registry.dispose()),
  );
  /** Waits until the feed matches, the client-side receipt for a frame. */
  const waitFor = (environmentId: EnvironmentId, done: (feed: PluginNotificationFeed) => boolean) =>
    AtomRegistry.toStream(registry, atoms.feed(environmentId)).pipe(
      Stream.filter(done),
      Stream.runHead,
    );
  return { environments, atoms, registry, waitFor };
});

const titles = (feed: PluginNotificationFeed) =>
  feed.received.map((entry) => entry.notification.title);

it.effect("starts live, then resumes from the last frame's cursor after a reconnect", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { environments, atoms, registry, waitFor } = yield* makeHarness();
      const [a] = environments;
      const unmount = registry.mount(atoms.feed(a.environmentId));

      yield* a.push(frame("epoch-1", 4, []));
      yield* a.push(frame("epoch-1", 5, [5]));
      yield* waitFor(a.environmentId, (feed) => titles(feed).join() === "n5");

      const push = yield* a.reconnect;
      // The server replays what was missed; a repeat of n5 is ignored.
      yield* push(frame("epoch-1", 7, [5, 6, 7]));
      yield* waitFor(a.environmentId, (feed) => titles(feed).join() === "n5,n6,n7");
      assert.deepStrictEqual(a.inputs, [{}, { after: { epoch: "epoch-1", sequence: 5 } }]);
      unmount();
    }),
  ),
);

it.effect("never subscribes to a server without the capability", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { environments, atoms, registry, waitFor } = yield* makeHarness();
      const [current, old] = environments;
      const unmountOld = registry.mount(atoms.feed(old.environmentId));
      const unmountCurrent = registry.mount(atoms.feed(current.environmentId));

      // Once a supported environment has delivered, any subscription would have started.
      yield* current.push(frame("epoch-1", 1, [1]));
      yield* waitFor(current.environmentId, (feed) => feed.received.length === 1);
      assert.deepStrictEqual(old.inputs, []);
      assert.strictEqual(
        registry.get(atoms.feed(old.environmentId)),
        EMPTY_PLUGIN_NOTIFICATION_FEED,
      );
      unmountOld();
      unmountCurrent();
    }),
  ),
);

it("keeps withdrawals by epoch and bounds both lists", () => {
  let feed = applyPluginNotificationFrame(EMPTY_PLUGIN_NOTIFICATION_FEED, frame("e1", 1, [1]));
  // Sequence 1 of a later epoch is a different notification.
  feed = applyPluginNotificationFrame(feed, frame("e2", 1, [1], []));
  feed = applyPluginNotificationFrame(feed, frame("e2", 1, [], [1]));
  assert.deepStrictEqual(
    feed.received.map((entry) => entry.key),
    ['["e1",1]', '["e2",1]'],
  );
  assert.deepStrictEqual(feed.withdrawn, ['["e2",1]']);
  // A frame with nothing new keeps the same feed.
  assert.strictEqual(applyPluginNotificationFrame(feed, frame("e2", 1, [1])), feed);

  for (let sequence = 2; sequence <= 30; sequence++)
    feed = applyPluginNotificationFrame(feed, frame("e2", sequence, [sequence], [sequence]));
  assert.strictEqual(feed.received.length, 20);
  assert.strictEqual(feed.withdrawn.length, 20);
  assert.strictEqual(feed.received.at(-1)?.key, '["e2",30]');
});

const toastFrame = (
  sequences: ReadonlyArray<number>,
  withdrawn: ReadonlyArray<number> = [],
): PluginNotificationFrame => ({
  epoch: "e",
  sequence: Math.max(0, ...sequences),
  notifications: sequences.map((sequence) => ({
    sequence,
    pluginId: "acme.ci",
    pluginName: "CI watcher",
    title: `n${sequence}`,
    ...(sequence === 2 ? { body: "Two failed" } : {}),
    createdAt: "2026-10-04T00:00:00.000Z",
  })),
  withdrawn,
});

describe("pluginNotificationChanges", () => {
  it("toasts each notification once and closes only shown ones that were withdrawn", () => {
    const handled = new Set<string>();
    let feed = applyPluginNotificationFrame(EMPTY_PLUGIN_NOTIFICATION_FEED, toastFrame([1, 2]));
    const first = pluginNotificationChanges(feed, handled);
    assert.deepStrictEqual(
      first.show.map((entry) => entry.notification.title),
      ["n1", "n2"],
    );
    assert.deepStrictEqual(pluginNotificationChanges(feed, handled).show, []);

    // Withdrawn before it was ever shown: never toasted, and nothing to close.
    feed = applyPluginNotificationFrame(feed, toastFrame([], [3]));
    feed = applyPluginNotificationFrame(feed, toastFrame([3]));
    feed = applyPluginNotificationFrame(feed, toastFrame([], [1]));
    const later = pluginNotificationChanges(feed, handled);
    assert.deepStrictEqual(later.show, []);
    assert.deepStrictEqual(later.close, ['["e",1]']);
  });

  it("names the plugin beside the body", () => {
    const feed = applyPluginNotificationFrame(EMPTY_PLUGIN_NOTIFICATION_FEED, toastFrame([1, 2]));
    assert.deepStrictEqual(feed.received.map(pluginNotificationDescription), [
      "From CI watcher",
      "Two failed · CI watcher",
    ]);
  });
});
