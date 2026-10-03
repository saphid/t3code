import {
  EnvironmentId,
  PluginInstallationId,
  type PluginSettingField,
  type PluginSettingsValues,
  type ServerConfig,
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
  createPluginSettingsEnvironmentAtoms,
  pluginSettingDraftChange,
  pluginSettingRows,
  pluginSettingsStream,
} from "./pluginSettings.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const INSTALLATION_ID = PluginInstallationId.make("installation-1");
const VALUES: PluginSettingsValues = {
  installationId: INSTALLATION_ID,
  values: [{ key: "retries", value: 9 }],
  secrets: ["token"],
};

/** A session to a server reporting `capabilities` that records each call it receives. */
const recordingSession = (
  capabilities: ServerConfig["environment"]["capabilities"],
  calls: Array<{ readonly method: string; readonly input: unknown }>,
): RpcSession.RpcSession => ({
  client: new Proxy(
    {},
    {
      get: (_target, method: string) => (input: unknown) => {
        calls.push({ method, input });
        return method === WS_METHODS.pluginsSettingsSubscribe
          ? Stream.succeed(VALUES).pipe(Stream.concat(Stream.never))
          : Effect.succeed(VALUES);
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

const failureTag = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  AsyncResult.isFailure(result)
    ? Option.getOrUndefined(Cause.findErrorOption(result.cause) as Option.Option<{ _tag: string }>)
        ?._tag
    : undefined;

describe("plugin settings on the wire", () => {
  it.effect("calls only a server that announces plugin settings", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const [capabilities, expected] of [
          [{ repositoryIdentity: true, plugins: true }, { _tag: "unsupported" }],
          [
            { repositoryIdentity: true, plugins: true, pluginSettings: true },
            { _tag: "available", values: VALUES },
          ],
        ] as const) {
          const calls: Array<{ readonly method: string; readonly input: unknown }> = [];
          const session = recordingSession(capabilities, calls);
          const supervisor = yield* makeSupervisor(session);
          const view = yield* pluginSettingsStream(INSTALLATION_ID).pipe(
            Stream.runHead,
            Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
          );
          expect(Option.getOrThrow(view)).toEqual(expected);

          const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (
            _environmentId,
            effect,
          ) =>
            Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
          const environmentRegistry = EnvironmentRegistry.EnvironmentRegistry.of({
            run,
          } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
          const atoms = createPluginSettingsEnvironmentAtoms(
            Atom.runtime(
              Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry),
            ),
          );
          const registry = yield* Effect.acquireRelease(
            Effect.sync(AtomRegistry.make),
            (registry) => Effect.sync(() => registry.dispose()),
          );
          const result = yield* Effect.promise(() =>
            atoms.update.run(registry, {
              environmentId: TARGET.environmentId,
              input: { installationId: INSTALLATION_ID, changes: [{ key: "mode", value: "fast" }] },
            }),
          );
          if (expected._tag === "unsupported") {
            expect(failureTag(result)).toBe("EnvironmentRpcUnavailableError");
            expect(calls).toEqual([]);
          } else {
            expect(AsyncResult.isSuccess(result)).toBe(true);
            expect(calls.map((call) => call.method)).toEqual([
              WS_METHODS.pluginsSettingsSubscribe,
              WS_METHODS.pluginsSettingsUpdate,
            ]);
          }
        }
      }),
    ),
  );
});

describe("plugin settings form", () => {
  const fields: ReadonlyArray<PluginSettingField> = [
    { type: "secret", key: "token", label: "Token" },
    { type: "number", key: "retries", label: "Retries", min: 0, max: 5, integer: true, default: 2 },
    { type: "boolean", key: "verbose", label: "Verbose" },
  ];

  it("shows defaults for values that do not fit and never a secret", () => {
    expect(pluginSettingRows(fields, VALUES)).toEqual([
      { field: fields[0], value: undefined, saved: true },
      { field: fields[1], value: 2, saved: true },
      { field: fields[2], value: undefined, saved: false },
    ]);
  });

  it("turns drafts into changes and explains the ones it cannot save", () => {
    const [token, retries, verbose] = fields as [
      PluginSettingField,
      PluginSettingField,
      PluginSettingField,
    ];
    expect(pluginSettingDraftChange(token, "")).toEqual({ _tag: "unchanged" });
    expect(pluginSettingDraftChange(token, "abc")).toEqual({
      _tag: "change",
      change: { key: "token", value: "abc" },
    });
    expect(pluginSettingDraftChange(retries, " 3 ")).toEqual({
      _tag: "change",
      change: { key: "retries", value: 3 },
    });
    for (const draft of ["", "three", "3.5", "8"])
      expect(pluginSettingDraftChange(retries, draft)._tag).toBe("invalid");
    expect(pluginSettingDraftChange(verbose, true)).toEqual({
      _tag: "change",
      change: { key: "verbose", value: true },
    });
  });
});
