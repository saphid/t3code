import type { SurfaceDescriptor, Json } from "./contracts.js";
import type { SurfaceContribution, ViewSession } from "./host.js";
import type { SurfaceRenderer } from "./react.js";
import {
  validateEnvironmentPackage,
  type ClientHost,
  type ClientFactory,
  type EnvironmentPackage,
} from "./environment.js";
import {
  bindApi,
  type ApiDefinition,
  type ApiRequirement,
  type PluginDependency,
  type TypedApi,
  type ApiMethodTypes,
} from "./capabilities.js";

export interface AuthoredSurface extends Omit<
  SurfaceDescriptor,
  "id" | "capabilities" | "stateVersion" | "placements" | "clients"
> {
  /** Local contribution name. The package identity supplies the namespace. */
  readonly name: string;
  readonly placements?: SurfaceDescriptor["placements"];
  readonly clients?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly stateVersion?: number;
  readonly validateRestore?: SurfaceContribution<SurfaceRenderer>["validateRestore"];
  createView(
    host: ClientHost,
    session: ViewSession,
  ): ReturnType<SurfaceContribution<SurfaceRenderer>["createView"]>;
}
export interface ExtensionSource {
  readonly id: string;
  readonly version: string;
  readonly surfaces?: readonly AuthoredSurface[];
  readonly provides?: readonly ApiDefinition[];
  readonly requires?: readonly ApiRequirement[];
  readonly dependencies?: readonly PluginDependency[];
  /** Separate Node source entry, bundled only for the server. */
  readonly serverEntry?: string;
}
export interface AuthoredExtension {
  readonly package: EnvironmentPackage;
  readonly client?: ClientFactory;
  readonly serverEntry?: string;
}

/** Produces existing installable contracts. It neither installs code nor grants authority. */
export function defineExtension(source: ExtensionSource): AuthoredExtension {
  const surfaces = source.surfaces ?? [];
  const provides = source.provides ?? [];
  const manifest = {
    id: source.id,
    version: source.version,
    apiVersion: 1 as const,
    surfaces: surfaces.map(
      ({ name, title, scope, placements, clients, capabilities, stateVersion }) => ({
        id: source.id + "/" + name,
        title,
        scope,
        placements: placements ?? ["side-panel" as const],
        clients: clients ?? ["web", "desktop"],
        capabilities: capabilities ?? [],
        stateVersion: stateVersion ?? 1,
      }),
    ),
  };
  const pkg = validateEnvironmentPackage({
    format: provides.some((api) => api.streams?.length) ? 3 : 2,
    manifest,
    ...(surfaces.length ? { clientEntry: "client.mjs" } : {}),
    ...(source.serverEntry ? { serverEntry: "server.mjs" } : {}),
    tools: [],
    provides,
    requires: source.requires ?? [],
    dependencies: source.dependencies ?? [],
  });
  return {
    package: pkg,
    ...(source.serverEntry ? { serverEntry: source.serverEntry } : {}),
    ...(surfaces.length
      ? {
          client: (host: ClientHost) => ({
            manifest: pkg.manifest,
            surfaces: surfaces.map((surface) => ({
              id: source.id + "/" + surface.name,
              validateRestore: surface.validateRestore ?? ((state: Json) => state === null),
              createView: (session: ViewSession) => surface.createView(host, session),
            })),
          }),
        }
      : {}),
  };
}

export function requireApi(
  api: { readonly definition: ApiDefinition },
  versionRange = "^" + api.definition.version,
): ApiRequirement {
  return { id: api.definition.id, versionRange };
}

export type ApiReadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "unavailable"; readonly error: string };

/** Read-only React query: scope, visibility, cancellation and stale-result suppression are supplied. */
/* oxlint-disable react/hooks -- React is injected once per host/view lifetime, avoiding a bundled second React. */
export function useApiRead<T extends ApiMethodTypes, K extends keyof T & string>(
  host: ClientHost,
  session: ViewSession,
  api: TypedApi<T>,
  method: K,
  input: T[K]["input"],
): ApiReadState<T[K]["output"]> {
  const { useEffect, useState } = host.React;
  const definition = api.definition.methods?.find((item) => item.name === method);
  if (!definition || definition.effect !== "read")
    throw new Error("useApiRead requires a declared read method");
  const [visible, setVisible] = useState(session.visible);
  const key = JSON.stringify([api.definition, method, input, session.context, visible]);
  const [state, setState] = useState<{ key: string; result: ApiReadState<T[K]["output"]> }>();
  useEffect(() => session.onVisibility(setVisible), [session]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const client = bindApi(api, host, session.context);
    setState({ key, result: { status: "loading" } });
    void client.invoke(method, input, signal).then(
      (value) => {
        if (!signal.aborted) setState({ key, result: { status: "ready", value } });
      },
      (error) => {
        if (!signal.aborted)
          setState({
            key,
            result: {
              status: "unavailable",
              error: error instanceof Error ? error.message : "API unavailable",
            },
          });
      },
    );
    return () => controller.abort();
  }, [key, host, session]);
  return state?.key === key ? state.result : { status: "loading" };
}
/* oxlint-enable react/hooks */
