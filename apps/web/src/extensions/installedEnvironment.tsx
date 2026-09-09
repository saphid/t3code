import * as React from "react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { environmentExtensionsHttp } from "@t3tools/client-runtime/state/extensions";
import {
  ExtensionInvokeInput,
  type EnvironmentId,
  type ExtensionInstallInput,
  type ExtensionManageInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AtomRegistry } from "effect/unstable/reactivity";
import type { HttpClient } from "effect/unstable/http";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readPreparedConnection, usePreparedConnection } from "../state/session";
import { useEnvironments } from "../state/environments";
import { registerWorkspaceExtension } from "./workspaceRegistry";
import {
  createInstalledExtensionController,
  EMPTY_INSTALLED,
  type InstalledSnapshot,
} from "./installedController";

const snapshots = new Map<string, InstalledSnapshot>();
const controllers = new Map<string, ReturnType<typeof createInstalledExtensionController>>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function changed(environmentId: string, snapshot: InstalledSnapshot) {
  snapshots.set(environmentId, snapshot);
  for (const listener of listeners) listener();
}
export function useInstalledExtensions(environmentId: string | null) {
  const get = useCallback(
    () => (environmentId ? (snapshots.get(environmentId) ?? EMPTY_INSTALLED) : EMPTY_INSTALLED),
    [environmentId],
  );
  return useSyncExternalStore(subscribe, get, get);
}
function run<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime).pipe(
      Effect.flatMap((context) => effect.pipe(Effect.provide(context))),
    ),
    signal ? { signal } : undefined,
  );
}
/** Entries are trusted code. The authenticated server binds this body to the catalog's package hash. */
export async function importInstalledClient(code: string, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new Error("Installed client load cancelled");
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const revoke = () => URL.revokeObjectURL(url);
  signal.addEventListener("abort", revoke, { once: true });
  try {
    return (await import(/* @vite-ignore */ url)).default;
  } finally {
    signal.removeEventListener("abort", revoke);
    revoke();
  }
}
export function refreshInstalledExtensions(environmentId: string) {
  return controllers.get(environmentId)?.refresh() ?? Promise.resolve();
}
export async function manageInstalledExtension(
  environmentId: EnvironmentId,
  input: ExtensionManageInput,
) {
  const prepared = readPreparedConnection(environmentId);
  if (!prepared) throw new Error("Environment is not connected");
  const result = await run(environmentExtensionsHttp.manage(prepared, input));
  await refreshInstalledExtensions(environmentId);
  return result;
}
export async function installEnvironmentExtension(
  environmentId: EnvironmentId,
  input: ExtensionInstallInput,
) {
  const prepared = readPreparedConnection(environmentId);
  if (!prepared) throw new Error("Environment is not connected");
  const result = await run(environmentExtensionsHttp.install(prepared, input));
  await refreshInstalledExtensions(environmentId);
  return result;
}
function EnvironmentExtensions({ environmentId }: { environmentId: EnvironmentId }) {
  const prepared = usePreparedConnection(environmentId);
  useEffect(() => {
    if (Option.isNone(prepared)) {
      changed(environmentId, EMPTY_INSTALLED);
      return;
    }
    const connection = prepared.value;
    const controller = createInstalledExtensionController({
      environmentId,
      React,
      list: (signal) => run(environmentExtensionsHttp.list(connection), signal),
      client: (id, expectedContentHash, signal) =>
        run(environmentExtensionsHttp.client(connection, { id, expectedContentHash }), signal),
      invoke: async (toolId, input, context, expectedContentHash, signal) => {
        const payload = Schema.decodeSync(ExtensionInvokeInput)({
          toolId,
          input,
          context,
          expectedContentHash,
        });
        return (await run(environmentExtensionsHttp.invoke(connection, payload), signal)).result;
      },
      load: importInstalledClient,
      register: (extension) => registerWorkspaceExtension(extension, undefined, { environmentId }),
      changed: (snapshot) => changed(environmentId, snapshot),
    });
    controllers.set(environmentId, controller);
    void controller.refresh();
    return () => {
      controller.dispose();
      if (controllers.get(environmentId) === controller) {
        controllers.delete(environmentId);
        changed(environmentId, EMPTY_INSTALLED);
      }
    };
  }, [environmentId, prepared]);
  return null;
}
export function InstalledExtensionsBootstrap() {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <EnvironmentExtensions
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}
