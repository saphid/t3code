import {
  EnvironmentId,
  PluginInstallationId,
  type PluginCatalogSnapshot,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type * as RpcSession from "../rpc/session.ts";
import { pluginCatalogStream } from "./plugins.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const SNAPSHOT: PluginCatalogSnapshot = {
  installations: [
    {
      installationId: PluginInstallationId.make("installation-1"),
      generation: 0,
      directory: "/srv/plugins/notifier",
      manifest: null,
      source: null,
      problem: "the directory does not exist.",
      inspectedAt: "2026-10-04T00:00:00.000Z",
      consent: null,
      enabled: false,
      addedAt: "2026-10-04T00:00:00.000Z",
    },
  ],
};

/** Runs the catalogue stream against one session whose server reports `capabilities`. */
const firstView = Effect.fn("firstView")(function* (
  capabilities: ServerConfig["environment"]["capabilities"],
) {
  const calls: Array<string> = [];
  const client = new Proxy(
    {},
    {
      get: (_target, method: string) => () => {
        calls.push(method);
        return method === WS_METHODS.pluginsSubscribe
          ? Stream.succeed(SNAPSHOT).pipe(Stream.concat(Stream.never))
          : Stream.never;
      },
    },
  ) as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
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
  const view = yield* pluginCatalogStream.pipe(
    Stream.runHead,
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
  );
  return { view: Option.getOrThrow(view), calls };
});

describe("pluginCatalogStream", () => {
  it.effect("never calls a server that does not announce the plugin catalogue", () =>
    Effect.gen(function* () {
      const { view, calls } = yield* firstView({ repositoryIdentity: true });
      expect(view).toEqual({ _tag: "unsupported" });
      expect(calls).toEqual([]);
    }),
  );

  it.effect("subscribes on a server that announces it", () =>
    Effect.gen(function* () {
      const { view, calls } = yield* firstView({ repositoryIdentity: true, plugins: true });
      expect(view).toEqual({ _tag: "available", installations: SNAPSHOT.installations });
      expect(calls).toEqual([WS_METHODS.pluginsSubscribe]);
    }),
  );
});
