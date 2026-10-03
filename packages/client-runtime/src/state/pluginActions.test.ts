import {
  EnvironmentId,
  PluginActionId,
  ProjectId,
  type PluginAction,
  type ServerConfig,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type * as RpcSession from "../rpc/session.ts";
import {
  createPluginActionEnvironmentAtoms,
  pluginActionsAt,
  pluginActionsStream,
} from "./pluginActions.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const action = (
  name: string,
  target: PluginAction["target"],
  placements: PluginAction["placements"],
) =>
  ({
    id: PluginActionId.make(`installation-1:1:${name}`),
    pluginId: "test.actions",
    pluginName: "Actions",
    name,
    title: name,
    target,
    placements,
  }) satisfies PluginAction;

const ACTIONS = [
  action("everywhere", "environment", ["command-palette", "thread-menu"]),
  action("on-project", "project", ["command-palette"]),
  action("on-thread", "thread", ["command-palette", "composer-slash"]),
];

/** One environment whose session reaches a server reporting `capabilities`, recording each call. */
const makeEnvironment = Effect.fn("makeEnvironment")(function* (
  capabilities: ServerConfig["environment"]["capabilities"],
) {
  const calls: Array<string> = [];
  const session: RpcSession.RpcSession = {
    client: new Proxy(
      {},
      {
        get: (_target, method: string) => () => {
          calls.push(method);
          return method === WS_METHODS.pluginActionsSubscribe
            ? Stream.succeed({ actions: ACTIONS }).pipe(Stream.concat(Stream.never))
            : Effect.succeed({ message: "done" });
        },
      },
    ) as WsRpcProtocolClient,
    initialConfig: Effect.succeed({ environment: { capabilities } } as ServerConfig),
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make<SupervisorConnectionState>(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const atoms = createPluginActionEnvironmentAtoms(
    Atom.runtime(
      Layer.succeed(
        EnvironmentRegistry.EnvironmentRegistry,
        EnvironmentRegistry.EnvironmentRegistry.of({
          run,
        } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
      ),
    ),
  );
  const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
    Effect.sync(() => registry.dispose()),
  );
  const firstList = pluginActionsStream.pipe(
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
  );
  const invoke = Effect.promise(() =>
    atoms.invoke.run(registry, {
      environmentId: TARGET.environmentId,
      input: { actionId: ACTIONS[0]!.id, target: { _tag: "environment" } },
    }),
  );
  return { calls, firstList, invoke };
});

const failureTag = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  AsyncResult.isFailure(result)
    ? Option.getOrUndefined(Cause.findErrorOption(result.cause) as Option.Option<{ _tag: string }>)
        ?._tag
    : undefined;

describe("plugin actions on an older server", () => {
  it.effect("offer nothing and send nothing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const capabilities of [
          { repositoryIdentity: true },
          { repositoryIdentity: true, plugins: true, pluginActions: false },
        ]) {
          const { calls, firstList, invoke } = yield* makeEnvironment(capabilities);
          expect(yield* firstList).toEqual([]);
          expect(failureTag(yield* invoke)).toBe("EnvironmentRpcUnavailableError");
          expect(calls).toEqual([]);
        }
      }),
    ),
  );

  it.effect("are listed and run on a server that announces them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { calls, firstList, invoke } = yield* makeEnvironment({
          repositoryIdentity: true,
          pluginActions: true,
        });
        expect(yield* firstList).toEqual(ACTIONS);
        const result = yield* invoke;
        expect(AsyncResult.isSuccess(result) && result.value).toEqual({ message: "done" });
        expect(calls).toEqual([WS_METHODS.pluginActionsSubscribe, WS_METHODS.pluginActionsInvoke]);
      }),
    ),
  );
});

describe("pluginActionsAt", () => {
  const names = (entries: ReturnType<typeof pluginActionsAt>) =>
    entries.map(({ action, target }) => [action.name, target._tag]);

  it("offers an action only where it is placed and its target is known", () => {
    const threadId = ThreadId.make("thread-1");
    const projectId = ProjectId.make("project-1");
    expect(names(pluginActionsAt(ACTIONS, "command-palette", { threadId, projectId }))).toEqual([
      ["everywhere", "environment"],
      ["on-project", "project"],
      ["on-thread", "thread"],
    ]);
    // A palette opened outside any thread or project.
    expect(
      names(pluginActionsAt(ACTIONS, "command-palette", { threadId: null, projectId: null })),
    ).toEqual([["everywhere", "environment"]]);
    expect(names(pluginActionsAt(ACTIONS, "thread-menu", { threadId, projectId }))).toEqual([
      ["everywhere", "environment"],
    ]);
    expect(
      names(pluginActionsAt(ACTIONS, "composer-slash", { threadId: null, projectId })),
    ).toEqual([]);
  });
});
