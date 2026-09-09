import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";
import type {
  ExtensionClientInput,
  ExtensionApiInvokeInput,
  ExtensionApiDiscoverInput,
  ExtensionApiSelection,
  ExtensionInstallInput,
  ExtensionInvokeInput,
  ExtensionManageInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { makeEnvironmentHttpApiClient } from "../rpc/http.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  type EnvironmentHttpAuthHeaders,
} from "./environmentHttpAuth.ts";

function request<A, E, R>(
  prepared: PreparedConnection,
  operation: string,
  execute: (
    client: Effect.Success<ReturnType<typeof makeEnvironmentHttpApiClient>>,
    headers: EnvironmentHttpAuthHeaders,
  ) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
    return yield* executeAuthenticatedEnvironmentHttpRequest({
      prepared,
      signer,
      remoteAuthorization,
      method: "POST",
      url: (base) => environmentEndpointUrl(base, "/api/extensions/" + operation),
      timeoutMs: 30_000,
      request: ({ client, headers }) => execute(client, headers),
    });
  });
}

/** Uses the same cookie, bearer and refreshed request-bound relay authorization as other environment HTTP requests. */
export const environmentExtensionsHttp = {
  invokeApi: (prepared: PreparedConnection, payload: ExtensionApiInvokeInput) =>
    request(prepared, "api/invoke", (client, headers) =>
      client.extensions.invokeApi({ payload, headers }),
    ),
  discoverApis: (prepared: PreparedConnection, payload: ExtensionApiDiscoverInput) =>
    request(prepared, "api/discover", (client, headers) =>
      client.extensions.discoverApis({ payload, headers }),
    ),
  selectApi: (prepared: PreparedConnection, payload: ExtensionApiSelection) =>
    request(prepared, "api/select", (client, headers) =>
      client.extensions.selectApi({ payload, headers }),
    ),

  list: (prepared: PreparedConnection) =>
    request(prepared, "list", (client, headers) =>
      client.extensions.list({ payload: {}, headers }),
    ),
  client: (prepared: PreparedConnection, payload: ExtensionClientInput) =>
    request(prepared, "client", (client, headers) =>
      client.extensions.client({ payload, headers }),
    ),
  invoke: (prepared: PreparedConnection, payload: ExtensionInvokeInput) =>
    request(prepared, "invoke", (client, headers) =>
      client.extensions.invoke({ payload, headers }),
    ),
  install: (prepared: PreparedConnection, payload: ExtensionInstallInput) =>
    request(prepared, "install", (client, headers) =>
      client.extensions.install({ payload, headers }),
    ),
  manage: (prepared: PreparedConnection, payload: ExtensionManageInput) =>
    request(prepared, "manage", (client, headers) =>
      client.extensions.manage({ payload, headers }),
    ),
};

/** Initial receipts replay on each authenticated session, including reconnection. No timer or retries. */
export function createExtensionCatalogueAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:extensions:catalogue",
    tag: WS_METHODS.subscribeExtensionCatalogue,
    idleTtlMs: 0,
  });
}
