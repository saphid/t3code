import type { ClientProviderCaller } from "@t3tools/contracts";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type { InstalledPackage } from "./installedController";

import { ClientProviderOpError } from "@t3tools/client-runtime/client-provider-connection";
export { ClientProviderOpError } from "@t3tools/client-runtime/client-provider-connection";
import type {
  ClientProviderInvokeCall as SharedInvokeCall,
  ClientProviderStreamCall as SharedStreamCall,
  ClientLocalProvider as SharedLocalProvider,
} from "@t3tools/client-runtime/client-provider-connection";
export type ClientProviderInvokeCall = SharedInvokeCall<ViewContext>;
export type ClientProviderStreamCall = SharedStreamCall<ViewContext>;
export type ClientLocalProvider = SharedLocalProvider<ViewContext>;

export function readInputObject(input: Json): Record<string, Json> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new ClientProviderOpError("provider-rejected", "Expected an object input");
  return input as Record<string, Json>;
}

export function readInputString(
  input: Record<string, Json>,
  key: string,
  required = true,
): string | undefined {
  const value = input[key];
  if (value === undefined) {
    if (required) throw new ClientProviderOpError("provider-rejected", `Missing ${key}`);
    return undefined;
  }
  if (typeof value !== "string" || !value)
    throw new ClientProviderOpError("provider-rejected", `Invalid ${key}`);
  return value;
}

/** What a provider needs to re-authorize a broker-forwarded caller locally. */
export interface ClientProviderAuthDeps {
  readonly environmentId: string;
  readonly installations: () => readonly InstalledPackage[] | undefined;
}

/**
 * The provider re-checks the broker-forwarded caller + context against the
 * installation's locally known grants: the server authenticates the caller,
 * but the client owns the final grant decision for client-local state.
 */
export function authorizeCaller(
  deps: ClientProviderAuthDeps,
  caller: ClientProviderCaller,
  context: ViewContext,
  grants: readonly string[],
): InstalledPackage {
  const installation = deps.installations()?.find((item) => item.id === caller.installationId);
  if (!installation || installation.contentHash !== caller.contentHash)
    throw new ClientProviderOpError("client-target-denied", "Unknown or stale caller");
  for (const grant of grants) {
    if (!installation.grants.capabilities.includes(grant))
      throw new ClientProviderOpError("client-target-denied", `Missing grant ${grant}`);
  }
  if (context.resource.environmentId !== deps.environmentId)
    throw new ClientProviderOpError("client-target-denied", "Foreign environment context");
  const projectId = context.resource.projectId;
  if (projectId !== undefined && !installation.grants.projectIds.some((id) => id === projectId))
    throw new ClientProviderOpError("client-target-denied", "Context outside granted scope");
  return installation;
}
