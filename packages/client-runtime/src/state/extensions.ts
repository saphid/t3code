import type {
  ExtensionClientInput,
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
