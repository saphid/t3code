import {
  type ExecutionEnvironmentCapabilities,
  type PluginInstallation,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { subscribe } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";

/** One environment's plugins, or `unsupported` for a server that has no plugin catalogue. */
export type PluginCatalogView =
  | { readonly _tag: "unsupported" }
  | { readonly _tag: "available"; readonly installations: ReadonlyArray<PluginInstallation> };

const supportsPluginCatalog = (
  capabilities: Pick<ExecutionEnvironmentCapabilities, "plugins"> | null | undefined,
) => capabilities?.plugins === true;

const UNSUPPORTED: PluginCatalogView = { _tag: "unsupported" };

/**
 * Follows the environment's sessions and checks each server's capability
 * before subscribing, so a server without the catalogue never receives a
 * plugin call.
 */
export const pluginCatalogStream = Stream.unwrap(
  EnvironmentSupervisor.EnvironmentSupervisor.pipe(
    Effect.map((supervisor) =>
      SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.empty,
            onSome: (session) =>
              Stream.unwrap(
                session.initialConfig.pipe(
                  Effect.map((config) =>
                    supportsPluginCatalog(config.environment.capabilities)
                      ? subscribe(WS_METHODS.pluginsSubscribe, {}).pipe(
                          Stream.map((snapshot): PluginCatalogView => ({
                            _tag: "available",
                            installations: snapshot.installations,
                          })),
                        )
                      : Stream.succeed(UNSUPPORTED),
                  ),
                  // A session that never delivered its config has nothing to show yet.
                  Effect.orElseSucceed(() => Stream.empty),
                ),
              ),
          }),
        ),
      ),
    ),
  ),
);

export function createPluginEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Management steps for one environment run in order, matching the server's own lock.
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { environmentId: string }) => environmentId,
  };
  return {
    /** The live catalogue with each enabled plugin's process state. */
    catalog: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:plugins:catalog",
      subscribe: (_input: Record<string, never>) => pluginCatalogStream,
    }),
    add: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plugins:add",
      tag: WS_METHODS.pluginsAdd,
      scheduler,
      concurrency,
    }),
    refresh: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plugins:refresh",
      tag: WS_METHODS.pluginsRefresh,
      scheduler,
      concurrency,
    }),
    consent: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plugins:consent",
      tag: WS_METHODS.pluginsConsent,
      scheduler,
      concurrency,
    }),
    enable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plugins:enable",
      tag: WS_METHODS.pluginsEnable,
      scheduler,
      concurrency,
    }),
    disable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plugins:disable",
      tag: WS_METHODS.pluginsDisable,
      scheduler,
      concurrency,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plugins:remove",
      tag: WS_METHODS.pluginsRemove,
      scheduler,
      concurrency,
    }),
    resume: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plugins:resume",
      tag: WS_METHODS.pluginsResume,
      scheduler,
      concurrency,
    }),
  };
}
