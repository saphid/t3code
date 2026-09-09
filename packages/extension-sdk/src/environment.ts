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
export interface EnvironmentPackage {
  readonly format: 1;
  readonly manifest: ExtensionManifest;
  readonly clientEntry?: string;
  readonly serverEntry?: string;
  readonly tools: readonly ToolDescriptor[];
}
export interface ToolSession {
  readonly context: ViewContext;
  readonly signal: AbortSignal;
  invoke(capability: string, input: Json): Promise<Json>;
}
export interface ServerTool {
  readonly id: string;
  invoke(input: Json, session: ToolSession): Json | Promise<Json>;
}
export interface ServerExtension {
  readonly tools: readonly ServerTool[];
}
export interface ClientHost {
  /** Use this React identity; a client entry must not bundle or import another React runtime. */
  readonly React: typeof React;
  /** Host resolves installed grants and authenticated scope; supplied context is not authority. */
  invokeTool(toolId: string, input: Json, context: ViewContext, signal: AbortSignal): Promise<Json>;
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
    pkg.format !== 1 ||
    Object.keys(pkg).some(
      (key) => !["format", "manifest", "clientEntry", "serverEntry", "tools"].includes(key),
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
  return { tools: definition.tools.map((tool) => ({ id: tool.id, invoke: tool.invoke })) };
}
