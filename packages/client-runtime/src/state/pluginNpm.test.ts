import {
  EnvironmentId,
  PluginInstallationId,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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
import { createPluginNpmEnvironmentAtoms, listPluginNpmPackages } from "./pluginNpm.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

/** A session to a server reporting `capabilities` that records each call it receives. */
const recordingSession = (
  capabilities: ServerConfig["environment"]["capabilities"],
  calls: Array<string>,
): RpcSession.RpcSession => ({
  client: new Proxy(
    {},
    {
      get: (_target, method: string) => () => {
        calls.push(method);
        return Effect.succeed({ packages: [] });
      },
    },
  ) as WsRpcProtocolClient,
  initialConfig: Effect.succeed({ environment: { capabilities } } as ServerConfig),
  subscribeServerConfig: () => Stream.never,
  ready: Effect.void,
  probe: Effect.void,
  closed: Effect.never,
});

const makeSupervisor = Effect.fn("makeSupervisor")(function* (session: RpcSession.RpcSession) {
  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make<SupervisorConnectionState>(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
});

/** Runs every npm command against `session` and reports each result's failure tag. */
const runCommands = Effect.fn("runCommands")(function* (session: RpcSession.RpcSession) {
  const supervisor = yield* makeSupervisor(session);
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const atoms = createPluginNpmEnvironmentAtoms(
    Atom.runtime(
      Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, {
        run,
      } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
    ),
  );
  const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
    Effect.sync(() => registry.dispose()),
  );
  const environmentId = TARGET.environmentId;
  const installationId = PluginInstallationId.make("installation-1");
  const results = yield* Effect.forEach(
    [
      () =>
        atoms.add.run(registry, {
          environmentId,
          input: { name: "t3-plugin-hello", version: "1.0.0" },
        }),
      () =>
        atoms.stageUpdate.run(registry, {
          environmentId,
          input: { installationId, version: "latest" },
        }),
      () =>
        atoms.applyUpdate.run(registry, {
          environmentId,
          input: { installationId, digest: `sha256:${"0".repeat(64)}` },
        }),
      () => atoms.discardUpdate.run(registry, { environmentId, input: { installationId } }),
    ],
    (command) => Effect.promise(command),
  );
  const list = yield* listPluginNpmPackages.pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.exit,
  );
  return { results, list };
});

const failureTag = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  AsyncResult.isFailure(result)
    ? Option.getOrUndefined(Cause.findErrorOption(result.cause) as Option.Option<{ _tag: string }>)
        ?._tag
    : undefined;

describe("plugin npm commands", () => {
  it.effect("send nothing to a server that does not install from npm", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // A server with the catalogue but not npm installs is still an older server here.
        for (const capabilities of [
          { repositoryIdentity: true },
          { repositoryIdentity: true, plugins: true },
          { repositoryIdentity: true, plugins: true, pluginNpm: false },
        ]) {
          const calls: Array<string> = [];
          const { results, list } = yield* runCommands(recordingSession(capabilities, calls));
          expect(results.map(failureTag)).toEqual(
            results.map(() => "EnvironmentRpcUnavailableError"),
          );
          expect(Exit.isFailure(list)).toBe(true);
          expect(calls).toEqual([]);
        }
      }),
    ),
  );

  it.effect("send each command to a server that announces npm installs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: Array<string> = [];
        const { results, list } = yield* runCommands(
          recordingSession({ repositoryIdentity: true, plugins: true, pluginNpm: true }, calls),
        );
        expect(results.every(AsyncResult.isSuccess)).toBe(true);
        expect(Exit.isSuccess(list)).toBe(true);
        expect(calls).toEqual([
          WS_METHODS.pluginsNpmAdd,
          WS_METHODS.pluginsNpmStageUpdate,
          WS_METHODS.pluginsNpmApplyUpdate,
          WS_METHODS.pluginsNpmDiscardUpdate,
          WS_METHODS.pluginsNpmList,
        ]);
      }),
    ),
  );
});
