import * as React from "react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAtomValue } from "@effect/atom-react";
import { createCatalogueRefreshQueue } from "./catalogueRefresh";
import {
  createExtensionCatalogueAtoms,
  environmentExtensionsHttp,
  environmentExtensionApiStream,
} from "@t3tools/client-runtime/state/extensions";
import {
  ExtensionInvokeInput,
  ExtensionApiInvokeInput,
  ExtensionApiSubscribeInput,
  ExtensionApiDiscoverInput,
  extensionWorkspaceRevision,
  type EnvironmentId,
  type ExtensionInstallInput,
  type ExtensionManageInput,
  type ExtensionApiSelection,
  type ExtensionCatalogueChange,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import type { HttpClient } from "effect/unstable/http";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readPreparedConnection, usePreparedConnection } from "../state/session";
import { readProject } from "../state/entities";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useEnvironments } from "../state/environments";
import { registerWorkspaceExtension } from "./workspaceRegistry";
import {
  createInstalledExtensionController,
  EMPTY_INSTALLED,
  type InstalledSnapshot,
} from "./installedController";

import { registerInstalledApiClient, setInstalledApiPolicy } from "./installedApiClients";
import { createBrowserSurfaceBridge } from "./browserSurfaceBridge";
import {
  CLIENT_PROVIDER_CLIENT_TAG,
  CLIENT_PROVIDER_DESCRIPTORS,
  createClientProviders,
} from "./clientProviders";
import {
  currentClientConnectionId,
  emitClientProviderEvent,
  startClientProviderConnection,
} from "./clientProviderConnection";
import {
  attachRegistrationHandler,
  bindCommands,
  configureExtensionCommandEnvironment,
  stagedGlobalCommandsFor,
  unconfigureExtensionCommandEnvironment,
} from "./extensionCommandRegistry";

const decodeInvoke = Schema.decodeSync(ExtensionInvokeInput);
const decodeApiInvoke = Schema.decodeSync(ExtensionApiInvokeInput);
const decodeApiSubscribe = Schema.decodeSync(ExtensionApiSubscribeInput);
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
/** A pull-driven iterator retains only the RPC's bounded delivery window. */
async function* authenticatedApiFrames(
  environmentId: EnvironmentId,
  payload: ExtensionApiSubscribeInput,
  signal: AbortSignal,
) {
  const context = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime),
    { signal },
  );
  const iterable = Stream.toAsyncIterableWith(
    environmentExtensionApiStream(environmentId, payload),
    context,
  );
  const iterator = iterable[Symbol.asyncIterator]();
  const cancel = () => {
    void iterator.return?.().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new Error("Extension stream cancelled");
    while (!signal.aborted) {
      const next = await iterator.next();
      if (signal.aborted) throw new Error("Extension stream cancelled");
      if (next.done) return;
      const { cursor, ...frame } = next.value;
      yield {
        ...frame,
        ...(cursor === undefined ? {} : { cursor }),
      };
    }
    throw new Error("Extension stream cancelled");
  } finally {
    signal.removeEventListener("abort", cancel);
    await iterator.return?.();
  }
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
    const providers = createClientProviders({
      environmentId,
      client: CLIENT_PROVIDER_CLIENT_TAG,
      emit: (correlationId, event) => emitClientProviderEvent(environmentId, correlationId, event),
      installations: () => snapshots.get(environmentId)?.installations,
    });
    const flushStagedCommands = async (signal: AbortSignal) => {
      const snapshot = snapshots.get(environmentId);
      if (!snapshot) return;
      for (const installation of snapshot.installations) {
        if (signal.aborted) return;
        for (const entry of stagedGlobalCommandsFor(environmentId, installation.id)) {
          if (entry.status === "rejected" || signal.aborted) continue;
          try {
            const clientConnectionId = currentClientConnectionId(environmentId);
            if (!clientConnectionId) throw new Error("Client provider connection is not live");
            // The server scope resolver requires a granted project scope with a
            // matching workspace revision — derive it from the first granted
            // project exactly like the native surface-open path does.
            const projectId = installation.grants.projectIds[0];
            const project = projectId
              ? readProject(scopeProjectRef(environmentId, projectId))
              : undefined;
            if (!projectId || !project)
              throw new Error("No granted project scope for command registration");
            const payload = decodeApiInvoke({
              installationId: installation.id,
              expectedContentHash: installation.contentHash,
              request: {
                id: "t3.ui/keybindings",
                versionRange: "1.0.0",
                method: "registerCommands",
                input: { commands: entry.commands },
                context: {
                  client: CLIENT_PROVIDER_CLIENT_TAG,
                  resource: {
                    namespace: "t3.extensions",
                    id: installation.id,
                    environmentId,
                    projectId,
                  },
                  workspaceRevision: extensionWorkspaceRevision(project.workspaceRoot, null),
                },
                clientConnectionId,
              },
            });
            const result = await run(
              environmentExtensionsHttp.invokeApi(connection, payload),
              signal,
            );
            const output = result.result as {
              commandSetToken?: string;
              results?: readonly { commandId: string; status: string; reason?: string }[];
            };
            entry.status = "active";
            entry.token = output.commandSetToken;
            if (entry.handler && output.commandSetToken) {
              attachRegistrationHandler(environmentId, output.commandSetToken, entry.handler);
            }
            entry.rejections = (output.results ?? [])
              .filter((item) => item.status === "rejected")
              .map((item) => ({ commandId: item.commandId, reason: item.reason ?? "rejected" }));
          } catch (error) {
            entry.status = "rejected";
            entry.rejections = [
              {
                commandId: "*",
                reason: error instanceof Error ? error.message : "Registration failed",
              },
            ];
          }
          for (const listener of entry.listeners) listener();
        }
      }
    };
    const providerConnection = startClientProviderConnection({
      environmentId,
      providers,
      descriptors: CLIENT_PROVIDER_DESCRIPTORS,
      flushGlobalCommands: flushStagedCommands,
    });
    const controller = createInstalledExtensionController({
      environmentId,
      React,
      list: async (signal) => {
        const {
          apiSelections,
          apiResolution,
          pluginResolution,
          supportsCatalogueChanges,
          supportsApiStreams,
          supportedPackageFormats,
          ...result
        } = await run(environmentExtensionsHttp.list(connection), signal);
        return {
          ...result,
          supportsCatalogueChanges: supportsCatalogueChanges === true,
          supportsApiStreams: supportsApiStreams === true,
          supportedPackageFormats: supportedPackageFormats ?? [1, 2],
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
      readAsset: (id, expectedContentHash, path, signal) =>
        run(environmentExtensionsHttp.asset(connection, { id, expectedContentHash, path }), signal),
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
        // The session-validated `self` hint: stamps the socket-bound id the
        // seam minted so client-provider-backed contracts reach this client.
        const clientConnectionId = currentClientConnectionId(environmentId);
        const payload = decodeApiInvoke({
          installationId,
          expectedContentHash,
          request: clientConnectionId === undefined ? request : { ...request, clientConnectionId },
        });
        return (await run(environmentExtensionsHttp.invokeApi(connection, payload), signal)).result;
      },
      subscribeApi: (installationId, expectedContentHash, request, signal) => {
        const clientConnectionId = currentClientConnectionId(environmentId);
        return authenticatedApiFrames(
          environmentId,
          decodeApiSubscribe({
            installationId,
            expectedContentHash,
            request:
              clientConnectionId === undefined ? request : { ...request, clientConnectionId },
          }),
          signal,
        );
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
      browserSurface: createBrowserSurfaceBridge(environmentId),
      register: (extension, client) => {
        const unregister = registerWorkspaceExtension(
          extension,
          {
            authorize: () => false,
            bindCommands: (call) => bindCommands({ environmentId, ...call }),
          },
          { environmentId },
        );
        const stopClient = registerInstalledApiClient(environmentId, extension.manifest.id, client);
        return () => {
          stopClient();
          unregister();
        };
      },
      changed: (snapshot) => {
        changed(environmentId, snapshot);
        providerConnection.notifyInstallationsChanged();
      },
    });
    configureExtensionCommandEnvironment(environmentId, {
      installationGeneration: (id) => controller.installationEpoch(id),
      installationSurfaces: (id) =>
        snapshots.get(environmentId)?.installations.find((item) => item.id === id)?.package.manifest
          .surfaces ?? null,
      installationGrants: (id) =>
        snapshots.get(environmentId)?.installations.find((item) => item.id === id)?.grants
          .projectIds ?? null,
      client: CLIENT_PROVIDER_CLIENT_TAG,
    });
    const refreshQueue = createCatalogueRefreshQueue(() => controller.refresh());
    controllers.set(environmentId, controller);
    refreshQueues.set(environmentId, refreshQueue);
    void refreshQueue.request();
    return () => {
      providerConnection.stop();
      unconfigureExtensionCommandEnvironment(environmentId);
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
