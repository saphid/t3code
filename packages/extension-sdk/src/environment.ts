import {
  validateApiDefinition,
  validateApiRequirement,
  validateRangeText,
  type ApiDefinition,
  type ApiRequirement,
  type PluginDependency,
  type ApiInvocation,
  type ApiStreamInvocation,
  type ApiStreamFrame,
  type ApiDiscovery,
  type ApiStreamEvent,
} from "./capabilities.js";
import {
  assertProvidedApiOwner,
  type BrowserCaptureHost,
  type BrowserFramesHost,
  type BrowserSurfaceHost,
  type UiKeybindingsHost,
} from "./catalogue.js";
import type * as React from "react";
import {
  assertId,
  copyJson,
  validateManifest,
  type ExtensionManifest,
  type Json,
  type ViewContext,
} from "./contracts.js";
import type { Extension } from "./host.js";
import type { SurfaceRenderer } from "./react.js";

export const ENVIRONMENT_PACKAGE_FORMAT = 1;
export const ENVIRONMENT_MANIFEST_FILE = "t3-extension.json";
export type JsonObject = { readonly [key: string]: Json };
export interface ToolDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly readOnly: true;
  readonly capabilities: readonly string[];
}
export interface EnvironmentPackageV1 {
  readonly format: 1;
  readonly provides?: never;
  readonly requires?: never;
  readonly dependencies?: never;
  readonly manifest: ExtensionManifest;
  readonly clientEntry?: string;
  readonly serverEntry?: string;
  readonly tools: readonly ToolDescriptor[];
}
export interface EnvironmentPackageV2 extends Omit<
  EnvironmentPackageV1,
  "format" | "provides" | "requires" | "dependencies"
> {
  readonly format: 2;
  readonly dependencies: readonly PluginDependency[];
  readonly provides: readonly ApiDefinition[];
  readonly requires: readonly ApiRequirement[];
}
export interface EnvironmentPackageV3 extends Omit<EnvironmentPackageV2, "format"> {
  readonly format: 3;
}
export const ENVIRONMENT_ASSET_MEDIA_TYPES = [
  "application/wasm",
  "application/octet-stream",
  "font/woff2",
] as const;
export interface EnvironmentAsset {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly mediaType: (typeof ENVIRONMENT_ASSET_MEDIA_TYPES)[number];
}
export interface EnvironmentPackageV4 extends Omit<EnvironmentPackageV3, "format"> {
  readonly format: 4;
  readonly assets: readonly EnvironmentAsset[];
}
export type EnvironmentPackage =
  | EnvironmentPackageV1
  | EnvironmentPackageV2
  | EnvironmentPackageV3
  | EnvironmentPackageV4;
export interface ToolSession {
  readonly context: ViewContext;
  readonly signal: AbortSignal;
  invoke(capability: string, input: Json): Promise<Json>;
  invokeApi(request: Omit<ApiInvocation, "context">): Promise<Json>;
  subscribeApi(request: Omit<ApiStreamInvocation, "context">): AsyncIterable<ApiStreamFrame>;
}
export interface ServerTool {
  readonly id: string;
  invoke(input: Json, session: ToolSession): Json | Promise<Json>;
}
export interface ServerApi {
  readonly id: string;
  readonly methods?: readonly {
    readonly name: string;
    invoke(input: Json, session: ToolSession): Json | Promise<Json>;
  }[];
  readonly streams?: readonly {
    readonly name: string;
    subscribe(input: Json, session: ApiStreamSession): AsyncIterable<ApiStreamEvent>;
  }[];
}
export interface ApiStreamSession {
  readonly context: ViewContext;
  readonly signal: AbortSignal;
  readonly resumeCursor?: string;
  readonly invokeApi: (request: Omit<ApiInvocation, "context">) => Promise<Json>;
  readonly subscribeApi: (
    request: Omit<ApiStreamInvocation, "context">,
  ) => AsyncIterable<ApiStreamFrame>;
}
export interface ServerExtension {
  readonly apis?: readonly ServerApi[];
  readonly tools: readonly ServerTool[];
}
/** One command in an installation-scoped `t3.ui/keybindings` set. */
export type GlobalCommandDescriptor = {
  /** Plugin-local command id; dispatched as `ext.<pluginId>.<id>`. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /**
   * Key value(s) (`mod+shift+p` form) used when no user rule claims the key.
   * A list binds every spelling — e.g. `["mod+=", "mod++"]` for zoom in.
   */
  readonly defaultKey?: string | readonly string[];
  /**
   * Match `defaultKey` on the layout's `event.key` only, skipping the host's
   * physical-key (`event.code`) fallback for non-Latin layouts. For defaults
   * that must behave like a terminal's own key handling; user rules are
   * unaffected. Since t3.ui/keybindings 1.2.0; older hosts reject it.
   */
  readonly defaultKeyLogicalOnly?: boolean;
  /** Host-computable `when` expression over the shortcut context only. */
  readonly when?: string;
  readonly scope: "surface" | "thread" | "global";
  /**
   * Cold-open fallback: legal only on `scope:"global"` sets under
   * `t3.ui/keybindings.global` + `t3.ui/panels`; `surfaceId` must name a
   * surface in the calling installation's own manifest.
   */
  readonly activation?: {
    readonly surfaceId: string;
    readonly placement: "side-panel" | "bottom-dock";
  };
};

export type GlobalCommandRejection = {
  readonly commandId: string;
  readonly reason: string;
};

/**
 * Live view of a staged installation-scoped command set. `status` moves
 * "staged" → "active" once the registration commits on a live client-provider
 * connection, or "rejected" when the server refused the set. Fields reflect
 * the latest state; subscribe with `onDidChange`.
 */
export type GlobalCommandsHandle = {
  readonly status: "staged" | "active" | "rejected";
  readonly token?: string | undefined;
  readonly rejections?: readonly GlobalCommandRejection[] | undefined;
  onDidChange(listener: () => void): () => void;
};

export type GlobalCommandHandler = (call: {
  readonly commandId: string;
  readonly context: ViewContext;
}) => void;

/** Full-file contents for one changed file, used to expand context between hunks. */
export interface CodeViewFileContents {
  readonly oldContents: string;
  readonly newContents: string;
}

/**
 * A unified git patch rendered by the host's own diff viewer: highlighted
 * off the main thread, virtualized, themed with the app. Files are named by
 * their workspace-relative path as the patch spells it (`a/`/`b/` stripped).
 */
export interface CodeViewDiffProps {
  readonly patch: string;
  readonly layout: "unified" | "split";
  readonly wordWrap: boolean;
  /** Files whose bodies are folded to their header. */
  readonly collapsedPaths?: readonly string[];
  /** Offered on each file header when present; the plugin owns the fold state. */
  readonly onToggleCollapsed?: (path: string) => void;
  /** Scrolls `path` to the top once per distinct `requestId`. */
  readonly reveal?: { readonly path: string; readonly requestId: number };
  /** Text buttons drawn on every file header; a click reports the action id and path. */
  readonly fileActions?: readonly { readonly id: string; readonly label: string }[];
  readonly onFileAction?: (actionId: string, path: string) => void;
  /** Loads full contents when the reader expands context; absent keeps hunks only. */
  readonly loadContents?: (path: string) => Promise<CodeViewFileContents>;
  readonly className?: string;
}

/** One read-only file rendered by the host's source viewer. */
export interface CodeViewFileProps {
  /** Drives language detection. */
  readonly path: string;
  readonly contents: string;
  /** Absent follows the host's own word-wrap setting. */
  readonly wordWrap?: boolean;
  /** Centers and marks `line` (1-based) once per distinct `requestId`. */
  readonly reveal?: { readonly line: number; readonly requestId: number };
  readonly className?: string;
}

/**
 * `ClientHost.codeView` version 1. A rendering primitive over data the
 * plugin already holds, not a capability: no grant, no broker, no
 * catalogue entry. The host owns tokenization, its worker pool, theme sync
 * and virtualization; the plugin composes the components into its JSX.
 */
export interface ClientCodeView {
  readonly version: 1;
  readonly Diff: React.ComponentType<CodeViewDiffProps>;
  readonly File: React.ComponentType<CodeViewFileProps>;
}

/**
 * The host's code view when it offers version 1 or a compatible later one,
 * else null. Null is the plugin's cue to keep rendering its own rows.
 */
export function resolveCodeView(host: Pick<ClientHost, "codeView">): ClientCodeView | null {
  const member: unknown = host.codeView;
  if (!member || typeof member !== "object") return null;
  const { version, Diff, File } = member as Record<string, unknown>;
  return typeof version === "number" && version >= 1 && isComponent(Diff) && isComponent(File)
    ? (member as ClientCodeView)
    : null;
}

// React elements render from functions or memo/forwardRef exotics; arrays and
// plain objects are host bugs and must fall back, not render.
function isComponent(value: unknown): boolean {
  return (
    typeof value === "function" ||
    (typeof value === "object" && value !== null && "$$typeof" in value)
  );
}

/**
 * One popover in the host's floating layer. Everything but the placement
 * props lands on the popover element itself; the host adds its position,
 * stacking, and height cap on top of `style`.
 */
export interface FloatingPopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Placed against this element; null renders nothing. */
  readonly anchor: HTMLElement | null;
  /**
   * `bottom` and `top` open off that edge of the anchor and flip when the
   * other side has more room; `inset` sits inside the anchor's top corner.
   * Default `bottom`.
   */
  readonly side?: "bottom" | "top" | "inset";
  /** Which anchor edge the popover lines up with. Default `end`. */
  readonly align?: "start" | "end";
  /** CSS px from the anchor edge (or, inset, from its corner). Default 6. */
  readonly offset?: number;
  /** The popover is not a DOM descendant of the view: use this for outside-press checks. */
  readonly elementRef?: (element: HTMLDivElement | null) => void;
}

/**
 * `ClientHost.floatingLayer` version 1: menus and pills that must escape the
 * view's clipping ancestors and paint over a composited browser surface. The
 * host portals the popover to its top layer (the native menus' layer, above
 * every presented surface), marks it with `BROWSER_SURFACE_OVERLAY_ATTRIBUTE`,
 * keeps it inside the viewport, and caps its height at the space available
 * on its side so taller content scrolls. Portaled content inherits nothing
 * from the view's DOM, so pass theme custom properties in `style`.
 */
export interface ClientFloatingLayer {
  readonly version: 1;
  readonly Popover: React.ComponentType<FloatingPopoverProps>;
}

/** The host's floating layer at version 1 or later, else null (render in place). */
export function resolveFloatingLayer(
  host: Pick<ClientHost, "floatingLayer">,
): ClientFloatingLayer | null {
  const member: unknown = host.floatingLayer;
  if (!member || typeof member !== "object") return null;
  const { version, Popover } = member as Record<string, unknown>;
  return typeof version === "number" && version >= 1 && isComponent(Popover)
    ? (member as ClientFloatingLayer)
    : null;
}

export interface ClientHost {
  /** Use this React identity; a client entry must not bundle or import another React runtime. */
  readonly React: typeof React;
  invokeApi(request: ApiInvocation, signal: AbortSignal): Promise<Json>;
  subscribeApi(request: ApiStreamInvocation, signal: AbortSignal): AsyncIterable<ApiStreamFrame>;
  discoverApis(context: ViewContext, signal: AbortSignal): Promise<readonly ApiDiscovery[]>;
  readAsset?(
    path: string,
    signal: AbortSignal,
  ): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string; readonly sha256: string }>;
  /** Host resolves installed grants and authenticated scope; supplied context is not authority. */
  invokeTool(toolId: string, input: Json, context: ViewContext, signal: AbortSignal): Promise<Json>;
  /**
   * Stages an installation-scoped `t3.ui/keybindings` command set at factory
   * time. The synchronous `ClientFactory` cannot await the registration-gated
   * invoke, so the host records the set and flushes it once the installation
   * has committed and a live client-provider connection exists; reconnects
   * replay committed entries at the current installation generation. Absent on
   * hosts without a client-provider seam.
   */
  registerGlobalCommands?(
    commands: readonly GlobalCommandDescriptor[],
    handler?: GlobalCommandHandler,
  ): GlobalCommandsHandle;
  /**
   * `t3.browser/surface` host capability (catalogue contract, not a brokered
   * API). Absent on hosts that predate it — treat absence as the named
   * "host-unavailable" state.
   */
  readonly browserSurface?: BrowserSurfaceHost;
  /**
   * `t3.browser/frames` host capability — presents remote frames into a
   * caller-owned element when native compositing is unavailable. Absent on
   * hosts without a remote-frame transport (treat as "host-unavailable").
   */
  readonly browserFrames?: BrowserFramesHost;
  /**
   * `t3.browser/capture` host capability — captures a presented session into
   * the environment's attachment store and returns an artifactRef. Absent on
   * hosts that predate it (treat as "host-unavailable").
   */
  readonly browserCapture?: BrowserCaptureHost;
  /**
   * `t3.ui/keybindings@1.1.0` host capability — synchronous, client-local
   * keymap resolution. Absent on hosts that predate it or without the
   * `t3.ui/keybindings` grant (treat as "host-unavailable").
   */
  readonly keybindings?: UiKeybindingsHost;
  /**
   * Host-rendered highlighted, virtualized code. Absent on hosts without a
   * native viewer (mobile, older hosts) — read it through `resolveCodeView`
   * and keep plugin-owned rows as the fallback.
   */
  readonly codeView?: ClientCodeView;
  /**
   * Host floating layer for popovers. Absent on hosts without one — read it
   * through `resolveFloatingLayer` and render in place as the fallback.
   */
  readonly floatingLayer?: ClientFloatingLayer;
}
export type ClientFactory = (host: ClientHost) => Extension<SurfaceRenderer>;

function validateEntry(value: string): void {
  if (
    typeof value !== "string" ||
    value.length > 240 ||
    !/\.(mjs|js)$/.test(value) ||
    value
      .split("/")
      .some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === "..")
  )
    throw new Error("Entry must be a package-relative bundled ESM .mjs or .js file");
}
export function validateAssetPath(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 240 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))
  )
    throw new Error("Asset path must be package-relative ASCII segments");
}
function validateSchemaRefs(value: Json): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(validateSchemaRefs);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#")))
      throw new Error("Tool schemas cannot use external references");
    validateSchemaRefs(child);
  }
}
/** Validates the bounded portable shape. Runtime must compile each schema with strict draft-7 Ajv. */
export function validateEnvironmentPackage(value: unknown): EnvironmentPackage {
  const pkg = copyJson(value) as EnvironmentPackage;
  if (
    !pkg ||
    typeof pkg !== "object" ||
    Array.isArray(pkg) ||
    (pkg.format !== 1 && pkg.format !== 2 && pkg.format !== 3 && pkg.format !== 4) ||
    Object.keys(pkg).some(
      (key) =>
        !(
          pkg.format === 1
            ? ["format", "manifest", "clientEntry", "serverEntry", "tools"]
            : [
                "format",
                "manifest",
                "clientEntry",
                "serverEntry",
                "tools",
                "dependencies",
                "provides",
                "requires",
                ...(pkg.format === 4 ? ["assets"] : []),
              ]
        ).includes(key),
    )
  )
    throw new Error("Invalid environment package");
  const manifest = validateManifest(pkg.manifest);
  if (pkg.clientEntry === undefined && pkg.serverEntry === undefined)
    throw new Error("Package requires a client or server entry");
  if (pkg.clientEntry !== undefined) validateEntry(pkg.clientEntry);
  if (pkg.serverEntry !== undefined) validateEntry(pkg.serverEntry);
  if (
    !Array.isArray(pkg.tools) ||
    pkg.tools.length > 16 ||
    (pkg.tools.length > 0 && !pkg.serverEntry)
  )
    throw new Error("Invalid package tools or missing server entry");
  if (
    (manifest.surfaces.length ||
      manifest.composerContexts?.length ||
      manifest.messageDecorations?.length) &&
    !pkg.clientEntry
  )
    throw new Error("Client contributions require a client entry");
  const ids = new Set<string>();
  for (const tool of pkg.tools) {
    assertId(tool.id);
    if (!tool.id.startsWith(manifest.id + "/") || ids.has(tool.id))
      throw new Error("Duplicate or foreign tool");
    ids.add(tool.id);
    if (
      typeof tool.title !== "string" ||
      !tool.title.trim() ||
      tool.title.length > 200 ||
      typeof tool.description !== "string" ||
      !tool.description.trim() ||
      tool.description.length > 4000 ||
      tool.readOnly !== true ||
      !tool.inputSchema ||
      typeof tool.inputSchema !== "object" ||
      Array.isArray(tool.inputSchema) ||
      !Array.isArray(tool.capabilities) ||
      tool.capabilities.length > 16
    )
      throw new Error("Invalid tool descriptor");
    const capabilities = new Set<string>();
    for (const capability of tool.capabilities) {
      assertId(capability);
      if (capabilities.has(capability)) throw new Error("Duplicate tool capability");
      capabilities.add(capability);
    }
    validateSchemaRefs(tool.inputSchema);
  }
  if (pkg.format === 2 || pkg.format === 3 || pkg.format === 4) {
    for (const array of [pkg.dependencies, pkg.provides, pkg.requires])
      if (!Array.isArray(array) || array.length > 32)
        throw new Error("Invalid capability declarations");
    if (pkg.provides.length && !pkg.serverEntry)
      throw new Error("API providers require a server entry");
    const dependencies = new Set<string>();
    for (const dependency of pkg.dependencies) {
      assertId(dependency.pluginId);
      if (dependency.pluginId.includes("/") || dependencies.has(dependency.pluginId))
        throw new Error("Duplicate or invalid dependency");
      dependencies.add(dependency.pluginId);
      validateRangeText(dependency.versionRange);
      if (!Array.isArray(dependency.apis) || dependency.apis.length > 32)
        throw new Error("Invalid dependency APIs");
      const ids = new Set<string>();
      for (const api of dependency.apis) {
        validateApiRequirement(api);
        if (ids.has(api.id)) throw new Error("Duplicate dependency API");
        ids.add(api.id);
      }
    }
    const provided = new Set<string>();
    for (const api of pkg.provides) {
      validateApiDefinition(api);
      if (pkg.format === 2 && api.streams?.length)
        throw new Error("API streams require package format 3");
      assertProvidedApiOwner(manifest.id, api);
      if (provided.has(api.id)) throw new Error("Duplicate provided API");
      provided.add(api.id);
    }
    const required = new Set<string>();
    for (const api of pkg.requires) {
      validateApiRequirement(api);
      if (required.has(api.id)) throw new Error("Duplicate required API");
      required.add(api.id);
    }
  }
  if (pkg.format === 4) {
    if (!Array.isArray(pkg.assets) || pkg.assets.length > 32)
      throw new Error("Invalid package assets");
    const paths = new Set<string>();
    const entries = new Set([pkg.clientEntry, pkg.serverEntry, ENVIRONMENT_MANIFEST_FILE]);
    const allPaths = new Set([
      ...[pkg.clientEntry, pkg.serverEntry, ENVIRONMENT_MANIFEST_FILE].filter(
        (path): path is string => path !== undefined,
      ),
      ...pkg.assets.map((asset) => asset.path),
    ]);
    for (const asset of pkg.assets) {
      if (
        !asset ||
        typeof asset !== "object" ||
        Object.keys(asset).some(
          (key) => !["path", "byteLength", "sha256", "mediaType"].includes(key),
        ) ||
        typeof asset.path !== "string" ||
        !Number.isSafeInteger(asset.byteLength) ||
        asset.byteLength < 0 ||
        asset.byteLength > 4 * 1024 * 1024 ||
        typeof asset.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !ENVIRONMENT_ASSET_MEDIA_TYPES.includes(asset.mediaType)
      )
        throw new Error("Invalid package asset");
      validateAssetPath(asset.path);
      if (paths.has(asset.path) || entries.has(asset.path))
        throw new Error("Duplicate package asset");
      paths.add(asset.path);
    }
    for (const path of allPaths)
      for (const other of allPaths)
        if (path !== other && other.startsWith(path + "/"))
          throw new Error("Package path is an ancestor of another path");
    if (pkg.assets.reduce((total, asset) => total + asset.byteLength, 0) > 8 * 1024 * 1024)
      throw new Error("Package assets exceed aggregate limit");
  }
  return { ...pkg, manifest };
}
/** Match executable server handlers to the already validated installed tool catalog. */
export function validateServerExtension(pkg: EnvironmentPackage, value: unknown): ServerExtension {
  const safe = validateEnvironmentPackage(pkg);
  const definition = value as ServerExtension;
  if (
    !definition ||
    typeof definition !== "object" ||
    !Array.isArray(definition.tools) ||
    definition.tools.length !== safe.tools.length
  )
    throw new Error("Server tool definitions do not match package");
  const ids = new Set<string>();
  for (const tool of definition.tools) {
    if (
      !tool ||
      typeof tool.id !== "string" ||
      typeof tool.invoke !== "function" ||
      ids.has(tool.id) ||
      !safe.tools.some((item) => item.id === tool.id)
    )
      throw new Error("Duplicate, foreign or invalid server tool");
    ids.add(tool.id);
  }
  const expected = safe.format === 1 ? [] : safe.provides;
  const apis = definition.apis ?? [];
  if (!Array.isArray(apis) || apis.length !== expected.length)
    throw new Error("Server APIs do not match package");
  const apiIds = new Set<string>();
  for (const api of apis) {
    const descriptor = expected.find((item) => item.id === api.id);
    if (
      !descriptor ||
      apiIds.has(api.id) ||
      (descriptor.methods?.length ?? 0) !== (api.methods?.length ?? 0) ||
      (descriptor.streams?.length ?? 0) !== (api.streams?.length ?? 0)
    )
      throw new Error("Duplicate, foreign or invalid server API");
    apiIds.add(api.id);
    const names = new Set<string>();
    for (const method of api.methods ?? []) {
      if (
        names.has(method.name) ||
        !descriptor.methods?.some((item) => item.name === method.name) ||
        typeof method.invoke !== "function"
      )
        throw new Error("Server API methods do not match package");
      names.add(method.name);
    }
    for (const stream of api.streams ?? []) {
      if (
        names.has(stream.name) ||
        !descriptor.streams?.some((item) => item.name === stream.name) ||
        typeof stream.subscribe !== "function"
      )
        throw new Error("Server API streams do not match package");
      names.add(stream.name);
    }
  }
  return {
    tools: definition.tools.map((tool) => ({ id: tool.id, invoke: tool.invoke })),
    ...(apis.length
      ? {
          apis: apis.map((api) => ({
            id: api.id,
            ...(api.methods?.length
              ? {
                  methods: api.methods.map((method: NonNullable<ServerApi["methods"]>[number]) => ({
                    name: method.name,
                    invoke: method.invoke,
                  })),
                }
              : {}),
            ...(api.streams?.length
              ? {
                  streams: api.streams.map((stream: NonNullable<ServerApi["streams"]>[number]) => ({
                    name: stream.name,
                    subscribe: stream.subscribe,
                  })),
                }
              : {}),
          })),
        }
      : {}),
  };
}
