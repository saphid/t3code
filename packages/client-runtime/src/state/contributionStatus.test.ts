import {
  type ContributionStatusSnapshot,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  type ServerConfig,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
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
import { createContributionStatusEnvironmentAtoms } from "./contributionStatus.ts";

const THREAD = ThreadId.make("thread-1");

const snapshot = (text: string): ContributionStatusSnapshot => ({
  threads: [
    {
      threadId: THREAD,
      source: {
        kind: "provider-session",
        providerSessionId: ProviderSessionId.make(`session-${text}`),
        providerInstanceId: ProviderInstanceId.make("pi"),
        driver: ProviderDriverKind.make("pi"),
      },
      items: [{ key: "mode", text }],
    },
  ],
});

const config = (contributionStatus: boolean) =>
  ({
    environment: {
      serverVersion: "0.0.1",
      capabilities: contributionStatus ? { contributionStatus: true } : {},
    },
  }) as ServerConfig;

/** One environment whose server pushes status snapshots from a queue. */
const makeEnvironment = Effect.fn("makeEnvironment")(function* (id: string, supported: boolean) {
  const environmentId = EnvironmentId.make(id);
  let subscriptions = 0;
  const makeSession = Effect.fn("makeSession")(function* () {
    const frames = yield* Queue.unbounded<ContributionStatusSnapshot>();
    const client = {
      [WS_METHODS.subscribeContributionStatus]: () => {
        subscriptions += 1;
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
    return { session, push: (frame: ContributionStatusSnapshot) => Queue.offer(frames, frame) };
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
    subscriptions: () => subscriptions,
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
    yield* makeEnvironment("env-b", true),
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
  const atoms = createContributionStatusEnvironmentAtoms(runtime, {
    configValueAtom: (environmentId) => byId.get(environmentId)!.config,
  });
  const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
    Effect.sync(() => registry.dispose()),
  );
  /** Waits until a thread's rendered texts match, the client-side receipt for a frame. */
  const waitForTexts = (environmentId: EnvironmentId, texts: ReadonlyArray<string>) =>
    AtomRegistry.toStream(registry, atoms.threadItems(environmentId, THREAD)).pipe(
      Stream.filter(
        (items) =>
          items.length === texts.length && items.every((item, index) => item.text === texts[index]),
      ),
      Stream.runHead,
    );
  return { environments, atoms, registry, waitForTexts };
});

it.effect("keeps each environment's statuses apart and replaces them on reconnect", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { environments, atoms, registry, waitForTexts } = yield* makeHarness();
      const [a, b] = environments;
      const unmountA = registry.mount(atoms.threadItems(a.environmentId, THREAD));
      const unmountB = registry.mount(atoms.threadItems(b.environmentId, THREAD));

      yield* a.push(snapshot("plan"));
      yield* b.push(snapshot("build"));
      yield* waitForTexts(a.environmentId, ["plan"]);
      yield* waitForTexts(b.environmentId, ["build"]);

      // The status ended while disconnected; the new connection's first frame drops it.
      const pushAfterReconnect = yield* a.reconnect;
      yield* pushAfterReconnect({ threads: [] });
      yield* waitForTexts(a.environmentId, []);
      assert.strictEqual(a.subscriptions(), 2);
      assert.deepStrictEqual(
        registry.get(atoms.threadItems(b.environmentId, THREAD)).map((item) => item.text),
        ["build"],
      );
      unmountA();
      unmountB();
    }),
  ),
);

it.effect("never subscribes to a server without the capability", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { environments, atoms, registry, waitForTexts } = yield* makeHarness();
      const [current, , old] = environments;
      const unmountOld = registry.mount(atoms.threadItems(old.environmentId, THREAD));
      const unmountCurrent = registry.mount(atoms.threadItems(current.environmentId, THREAD));

      // Once a supported environment has delivered, any subscription would have started.
      yield* current.push(snapshot("plan"));
      yield* waitForTexts(current.environmentId, ["plan"]);
      assert.strictEqual(old.subscriptions(), 0);
      assert.deepStrictEqual(registry.get(atoms.threadItems(old.environmentId, THREAD)), []);
      unmountOld();
      unmountCurrent();
    }),
  ),
);
