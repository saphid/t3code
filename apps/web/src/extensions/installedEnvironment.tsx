import * as React from "react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAtomValue } from "@effect/atom-react";
import { createCatalogueRefreshQueue } from "./catalogueRefresh";
import {
  createExtensionCatalogueAtoms,
  environmentExtensionsHttp,
} from "@t3tools/client-runtime/state/extensions";
import {
  ExtensionInvokeInput,
  ExtensionApiInvokeInput,
  ExtensionApiDiscoverInput,
  type EnvironmentId,
  type ExtensionInstallInput,
  type ExtensionManageInput,
  type ExtensionApiSelection,
  type ExtensionCatalogueChange,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
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

import { registerInstalledApiClient, setInstalledApiPolicy } from "./installedApiClients";

const decodeInvoke = Schema.decodeSync(ExtensionInvokeInput);
const decodeApiInvoke = Schema.decodeSync(ExtensionApiInvokeInput);
const decodeApiDiscover = Schema.decodeSync(ExtensionApiDiscoverInput);
const idleCatalogue = Atom.make(AsyncResult.initial<ExtensionCatalogueChange, never>(false));
const catalogueChanges = createExtensionCatalogueAtoms(connectionAtomRuntime);
const refreshQueues = new Map<string, ReturnType<typeof createCatalogueRefreshQueue>>();
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
  return refreshQueues.get(environmentId)?.request() ?? Promise.resolve();
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
export async function selectInstalledApiProvider(
  environmentId: EnvironmentId,
  input: ExtensionApiSelection,
) {
  const prepared = readPreparedConnection(environmentId);
  if (!prepared) throw new Error("Environment is not connected");
  const result = await run(environmentExtensionsHttp.selectApi(prepared, input));
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
  const installed = useInstalledExtensions(environmentId);
  const catalogue = useAtomValue(
    installed.supportsCatalogueChanges === true
      ? catalogueChanges({ environmentId, input: {} })
      : idleCatalogue,
  );
  useEffect(() => {
    if (Option.isNone(prepared)) {
      changed(environmentId, EMPTY_INSTALLED);
      return;
    }
    const connection = prepared.value;
    const controller = createInstalledExtensionController({
      environmentId,
      React,
      list: async (signal) => {
        const {
          apiSelections,
          apiResolution,
          pluginResolution,
          supportsCatalogueChanges,
          ...result
        } = await run(environmentExtensionsHttp.list(connection), signal);
        return {
          ...result,
          supportsCatalogueChanges: supportsCatalogueChanges === true,
          ...(apiSelections === undefined ? {} : { apiSelections }),
          ...(apiResolution === undefined
            ? {}
            : {
                apiResolution: apiResolution.map(({ providerId, reason, ...item }) => ({
                  ...item,
                  ...(providerId === undefined ? {} : { providerId }),
                  ...(reason === undefined ? {} : { reason }),
                })),
              }),
          ...(pluginResolution === undefined
            ? {}
            : {
                pluginResolution: pluginResolution.map(({ reason, ...item }) => ({
                  ...item,
                  ...(reason === undefined ? {} : { reason }),
                })),
              }),
        };
      },
      client: (id, expectedContentHash, signal) =>
        run(environmentExtensionsHttp.client(connection, { id, expectedContentHash }), signal),
      invoke: async (toolId, input, context, expectedContentHash, signal) => {
        const payload = decodeInvoke({
          toolId,
          input,
          context,
          expectedContentHash,
        });
        return (await run(environmentExtensionsHttp.invoke(connection, payload), signal)).result;
      },
      invokeApi: async (installationId, expectedContentHash, request, signal) => {
        const payload = decodeApiInvoke({
          installationId,
          expectedContentHash,
          request,
        });
        return (await run(environmentExtensionsHttp.invokeApi(connection, payload), signal)).result;
      },
      discoverApis: async (installationId, expectedContentHash, context, signal) => {
        const payload = decodeApiDiscover({
          installationId,
          expectedContentHash,
          context,
        });
        return (
          await run(environmentExtensionsHttp.discoverApis(connection, payload), signal)
        ).apis.map(({ pluginId, reason, ...item }) => ({
          ...item,
          ...(pluginId === undefined ? {} : { pluginId }),
          ...(reason === undefined ? {} : { reason }),
        }));
      },
      policyChanged: (policy) => setInstalledApiPolicy(environmentId, policy),
      load: importInstalledClient,
      register: (extension, client) => {
        const unregister = registerWorkspaceExtension(extension, undefined, { environmentId });
        const stopClient = registerInstalledApiClient(environmentId, extension.manifest.id, client);
        return () => {
          stopClient();
          unregister();
        };
      },
      changed: (snapshot) => changed(environmentId, snapshot),
    });
    const refreshQueue = createCatalogueRefreshQueue(() => controller.refresh());
    controllers.set(environmentId, controller);
    refreshQueues.set(environmentId, refreshQueue);
    void refreshQueue.request();
    return () => {
      refreshQueue.dispose();
      controller.dispose();
      if (controllers.get(environmentId) === controller) {
        controllers.delete(environmentId);
        refreshQueues.delete(environmentId);
        setInstalledApiPolicy(environmentId, null);
        changed(environmentId, EMPTY_INSTALLED);
      }
    };
  }, [environmentId, prepared]);
  useEffect(() => {
    if (catalogue._tag === "Success") void refreshInstalledExtensions(environmentId);
  }, [environmentId, catalogue]);
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
