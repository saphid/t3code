import { assertId, copyJson, type Json, type ViewContext } from "./contracts.js";
import type { JsonObject } from "./environment.js";

export interface ApiMethod {
  readonly name: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly effect: "read" | "write";
  readonly requiredGrants: readonly string[];
}
export interface ApiDefinition {
  readonly id: string;
  readonly version: string;
  readonly methods: readonly ApiMethod[];
}
export interface ApiRequirement {
  readonly id: string;
  readonly versionRange: string;
}
export interface PluginDependency {
  readonly pluginId: string;
  readonly versionRange: string;
  readonly apis: readonly ApiRequirement[];
}
export interface ApiInvocation {
  readonly id: string;
  readonly versionRange: string;
  readonly method: string;
  readonly input: Json;
  readonly context: ViewContext;
  readonly expectedGeneration?: number;
  readonly requestId?: string;
}
export interface ApiSelection {
  readonly id: string;
  readonly providerId: string;
  readonly fallbackProviderIds: readonly string[];
}
export interface ApiUnavailableReason {
  readonly code: string;
  readonly detail: string;
  readonly relatedIds: readonly string[];
}
export interface ApiDiscovery {
  readonly id: string;
  readonly version: string;
  readonly providerId: string;
  readonly pluginId?: string;
  readonly generation: number;
  readonly health: "starting" | "ready" | "unavailable" | "failed";
  readonly selected: boolean;
  readonly reason?: ApiUnavailableReason;
}
export interface ApiClient {
  invokeApi(request: ApiInvocation, signal: AbortSignal): Promise<Json>;
  discoverApis(context: ViewContext, signal: AbortSignal): Promise<readonly ApiDiscovery[]>;
}
export type ApiMethodTypes = Record<string, { input: Json; output: Json }>;
/** Phantom method types accompany an immutable, serializable runtime descriptor. */
export interface TypedApi<T extends ApiMethodTypes> {
  readonly definition: ApiDefinition;
  readonly types?: T;
}
export function defineApi<T extends ApiMethodTypes>(definition: ApiDefinition): TypedApi<T> {
  return { definition: validateApiDefinition(definition) };
}
export function bindApi<T extends ApiMethodTypes>(
  api: TypedApi<T>,
  client: Pick<ApiClient, "invokeApi">,
  context: ViewContext,
  versionRange = "^" + api.definition.version,
) {
  return {
    invoke<K extends keyof T & string>(
      method: K,
      input: T[K]["input"],
      signal: AbortSignal,
    ): Promise<T[K]["output"]> {
      return client.invokeApi(
        { id: api.definition.id, versionRange, method, input, context },
        signal,
      ) as Promise<T[K]["output"]>;
    },
  };
}
export function validateRangeText(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error("Invalid API or dependency version range");
}
export function validateApiRequirement(value: ApiRequirement): ApiRequirement {
  const item = copyJson(value);
  assertId(item.id);
  validateRangeText(item.versionRange);
  return item;
}
export function validateApiSchema(value: unknown): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected API JSON schema");
  const walk = (node: Json): void => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#")))
        throw new Error("API schemas cannot use external references");
      walk(child);
    }
  };
  walk(copyJson(value) as Json);
}
export function validateApiDefinition(value: ApiDefinition): ApiDefinition {
  const api = copyJson(value);
  if (!api || typeof api !== "object" || Array.isArray(api))
    throw new Error("Invalid API definition");
  assertId(api.id);
  if (
    typeof api.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(api.version)
  )
    throw new Error("Invalid API version");
  if (!Array.isArray(api.methods) || !api.methods.length || api.methods.length > 32)
    throw new Error("Invalid API methods");
  const names = new Set<string>();
  for (const method of api.methods) {
    if (!method || typeof method !== "object") throw new Error("Invalid API method");
    if (
      typeof method.name !== "string" ||
      !/^[a-z][a-zA-Z0-9]{0,79}$/.test(method.name) ||
      names.has(method.name)
    )
      throw new Error("Duplicate or invalid API method");
    names.add(method.name);
    if (method.effect !== "read" && method.effect !== "write")
      throw new Error("Invalid API effect");
    validateApiSchema(method.inputSchema);
    validateApiSchema(method.outputSchema);
    if (
      !Array.isArray(method.requiredGrants) ||
      method.requiredGrants.length > 16 ||
      new Set(method.requiredGrants).size !== method.requiredGrants.length
    )
      throw new Error("Invalid API grants");
    method.requiredGrants.forEach(assertId);
  }
  return api;
}
