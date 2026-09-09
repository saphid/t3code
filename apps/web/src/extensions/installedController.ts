import type { ExtensionInstallation } from "@t3tools/contracts";
import {
  copyJson,
  validateContext,
  type Json,
  type ViewContext,
} from "@t3tools/extension-sdk/contracts";
import {
  validateEnvironmentPackage,
  type ClientFactory,
  type EnvironmentPackage,
} from "@t3tools/extension-sdk/environment";
import type { Extension } from "@t3tools/extension-sdk/host";
import type { SurfaceRenderer } from "@t3tools/extension-sdk/react";
import type * as React from "react";

export type InstalledPackage = Omit<ExtensionInstallation, "package"> & {
  readonly package: EnvironmentPackage;
};
export interface InstalledSnapshot {
  readonly installations: readonly InstalledPackage[];
  readonly loading: boolean;
  readonly error: string | null;
}
export const EMPTY_INSTALLED: InstalledSnapshot = {
  installations: [],
  loading: false,
  error: null,
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** Cancellation bounds waiting for async module evaluation; trusted synchronous code cannot be preempted. */
function waitForClient(
  load: (signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Installed client load cancelled"));
      return;
    }
    const loading = new AbortController();
    let settled = false;
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      loading.abort();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new Error("Installed client load cancelled"));
    const timer = setTimeout(() => finish(new Error("Installed client load timed out")), 10_000);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (settled) throw new Error("Installed client load cancelled");
        return load(loading.signal);
      })
      .then(
        (value) => finish(null, value),
        (error) =>
          finish(error instanceof Error ? error : new Error("Installed client load failed")),
      );
  });
}
export function createInstalledExtensionController(options: {
  readonly environmentId: string;
  readonly React: typeof React;
  readonly list: (
    signal: AbortSignal,
  ) => Promise<{ installations: readonly ExtensionInstallation[] }>;
  readonly client: (
    id: string,
    hash: string,
    signal: AbortSignal,
  ) => Promise<{ code: string; contentHash: string }>;
  readonly invoke: (
    toolId: string,
    input: Json,
    context: ViewContext,
    hash: string,
    signal: AbortSignal,
  ) => Promise<Json>;
  readonly load: (code: string, signal: AbortSignal) => Promise<unknown>;
  readonly register: (extension: Extension<SurfaceRenderer>) => () => void;
  readonly changed: (snapshot: InstalledSnapshot) => void;
}) {
  const active = new Map<string, { signature: string; stop: () => void }>();
  let generation = 0;
  let pending: AbortController | undefined;
  let disposed = false;
  let snapshot = EMPTY_INSTALLED;
  const publish = (next: InstalledSnapshot) => {
    snapshot = next;
    options.changed(next);
  };
  const clear = () => {
    for (const entry of active.values()) entry.stop();
    active.clear();
  };
  return {
    async refresh() {
      if (disposed) return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const current = ++generation;
      const live = () => !disposed && generation === current && !controller.signal.aborted;
      publish({ ...snapshot, loading: true, error: null });
      try {
        const response = await options.list(controller.signal);
        if (!live()) return;
        if (response.installations.length > 64)
          throw new Error("Environment extension limit exceeded");
        const installations = response.installations.map((item) => {
          const pkg = validateEnvironmentPackage(item.package);
          if (pkg.manifest.id !== item.id || !/^[a-f0-9]{64}$/.test(item.contentHash))
            throw new Error("Invalid installed package identity");
          return {
            ...item,
            grants: {
              capabilities: [...item.grants.capabilities],
              projectIds: [...item.grants.projectIds],
            },
            package: pkg,
          };
        });
        if (new Set(installations.map((item) => item.id)).size !== installations.length)
          throw new Error("Duplicate installed package");
        const signature = (item: InstalledPackage) => canonical([item.contentHash, item.grants]);
        for (const [id, entry] of active) {
          const item = installations.find((candidate) => candidate.id === id);
          if (!item?.enabled || !item.package.clientEntry || signature(item) !== entry.signature) {
            entry.stop();
            active.delete(id);
          }
        }
        const errors: string[] = [];
        for (const item of installations) {
          if (!live()) return;
          if (!item.enabled || !item.package.clientEntry || active.has(item.id)) continue;
          const lifetime = new AbortController();
          let registered = false;
          try {
            const code = await options.client(item.id, item.contentHash, controller.signal);
            if (!live()) return;
            if (
              code.contentHash !== item.contentHash ||
              new TextEncoder().encode(code.code).length > 1024 * 1024
            )
              throw new Error("Installed client changed or exceeds size limit");
            const factory = await waitForClient(
              (signal) => options.load(code.code, signal),
              controller.signal,
            );
            if (!live()) return;
            if (typeof factory !== "function")
              throw new Error("Installed client must export a factory");
            const identity = signature(item);
            const extension = (factory as ClientFactory)({
              React: options.React,
              async invokeTool(toolId, input, context, callerSignal) {
                const signal = AbortSignal.any([callerSignal, lifetime.signal]);
                const captured = validateContext(context);
                if (
                  !registered ||
                  disposed ||
                  signal.aborted ||
                  captured.resource.environmentId !== options.environmentId ||
                  !captured.resource.projectId ||
                  !item.grants.projectIds.some((id) => id === captured.resource.projectId) ||
                  !item.package.tools.some((tool) => tool.id === toolId)
                )
                  throw new Error("Installed tool is unavailable in this scope");
                const result = await options.invoke(
                  toolId,
                  copyJson(input),
                  captured,
                  item.contentHash,
                  signal,
                );
                if (disposed || signal.aborted)
                  throw new Error("Installed tool invocation expired");
                return copyJson(result);
              },
            });
            if (canonical(extension.manifest) !== canonical(item.package.manifest))
              throw new Error("Installed client manifest does not match its package");
            const unregister = options.register(extension);
            active.set(item.id, {
              signature: identity,
              stop: () => {
                lifetime.abort();
                unregister();
              },
            });
            registered = true;
          } catch (error) {
            if (!live()) return;
            errors.push(
              item.id + ": " + (error instanceof Error ? error.message : "Client unavailable"),
            );
          } finally {
            if (!registered) lifetime.abort();
          }
        }
        if (live())
          publish({
            installations,
            loading: false,
            error: errors.length ? errors.join("; ").slice(0, 2048) : null,
          });
      } catch (error) {
        if (!live()) return;
        clear();
        publish({
          installations: [],
          loading: false,
          error: error instanceof Error ? error.message : "Could not load environment extensions",
        });
      }
    },
    dispose() {
      disposed = true;
      generation++;
      pending?.abort();
      clear();
    },
  };
}
