import { expect, it } from "@effect/vitest";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentAuthenticatedPrincipal,
  ExtensionInvokeInput,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeOperations } from "./http.ts";
import { EnvironmentExtensions } from "./EnvironmentExtensions.ts";

const decodeInvocation = Schema.decodeUnknownEffect(ExtensionInvokeInput);
const encodePayload = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeCatalogueMetadata = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ supportsCatalogueChanges: Schema.Boolean })),
);

function fixture(scopes: readonly AuthEnvironmentScope[]) {
  const called: string[] = [];
  const service = EnvironmentExtensions.of({
    catalogue: Effect.succeed({ apiSelections: [], apiResolution: [], pluginResolution: [] }),
    invokeApi: () =>
      Effect.sync(() => {
        called.push("invokeApi");
        return { ok: true };
      }),
    discoverApis: () =>
      Effect.sync(() => {
        called.push("discoverApis");
        return [];
      }),
    selectApi: () =>
      Effect.sync(() => {
        called.push("selectApi");
      }),
    list: Effect.sync(() => {
      called.push("list");
      return [];
    }),
    client: () =>
      Effect.sync(() => {
        called.push("client");
        return { code: "fixture", contentHash: "a".repeat(64) };
      }),
    invoke: () =>
      Effect.sync(() => {
        called.push("invoke");
        return { ok: true };
      }),
    install: () =>
      Effect.sync(() => {
        called.push("install");
        return {
          id: "fixture",
          contentHash: "a".repeat(64),
          package: {},
          enabled: true,
          grants: { capabilities: [], projectIds: [] },
        };
      }),
    manage: () =>
      Effect.sync(() => {
        called.push("manage");
        return null;
      }),
    contextForThread: () => Effect.die("unused"),
    tools: () => Effect.die("unused"),
  });
  const operations = makeOperations(service);
  const principal = {
    sessionId: AuthSessionId.make("fixture-session"),
    subject: "fixture",
    method: "bearer-access-token" as const,
    scopes: new Set(scopes),
  };
  const provide = <A, E>(effect: Effect.Effect<A, E, EnvironmentAuthenticatedPrincipal>) =>
    effect.pipe(Effect.provideService(EnvironmentAuthenticatedPrincipal, principal));
  return { called, service, operations, provide };
}
it.effect("read credential can read but cannot install, update, enable or remove", () =>
  Effect.gen(function* () {
    const f = fixture([AuthOrchestrationReadScope]);
    expect(yield* f.provide(f.operations.list())).toEqual({
      installations: [],
      supportsCatalogueChanges: true,
      apiSelections: [],
      apiResolution: [],
      pluginResolution: [],
    });
    yield* f.provide(f.operations.client({ id: "fixture", expectedContentHash: "a".repeat(64) }));
    expect(
      (yield* f.provide(
        Effect.flip(
          f.operations.install({
            sourceDir: "/fixture",
            trusted: true,
            projectIds: [],
            capabilities: [],
          }),
        ),
      ))._tag,
    ).toBe("EnvironmentScopeRequiredError");
    for (const action of ["enable", "disable", "remove", "update", "rollback", "grants"] as const)
      expect(
        (yield* f.provide(Effect.flip(f.operations.manage({ id: "fixture", action }))))._tag,
      ).toBe("EnvironmentScopeRequiredError");
    expect(f.called).toEqual(["list", "client"]);
  }),
);
it.effect("missing read scope cannot inspect code, catalog or invoke even with access-write", () =>
  Effect.gen(function* () {
    const f = fixture([AuthAccessWriteScope]);
    const input = yield* decodeInvocation({
      toolId: "fixture/read",
      input: {},
      expectedContentHash: "a".repeat(64),
      context: { resource: { namespace: "fixture", id: "a", environmentId: "env" }, client: "web" },
    });
    expect((yield* f.provide(Effect.flip(f.operations.list())))._tag).toBe(
      "EnvironmentScopeRequiredError",
    );
    expect(
      (yield* f.provide(
        Effect.flip(f.operations.client({ id: "fixture", expectedContentHash: "a".repeat(64) })),
      ))._tag,
    ).toBe("EnvironmentScopeRequiredError");
    expect((yield* f.provide(Effect.flip(f.operations.invoke(input))))._tag).toBe(
      "EnvironmentScopeRequiredError",
    );
    expect(f.called).toEqual([]);
    yield* f.provide(f.operations.manage({ id: "fixture", action: "disable" }));
    expect(f.called).toEqual(["manage"]);
  }),
);

// Exercise the actual middleware and HTTP schemas without opening a listening socket.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi, AuthAdministrativeScopes } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { environmentAuthenticatedAuthLayer } from "../auth/http.ts";
import { extensionsHttpApiLayer } from "./http.ts";

class ExtensionTestApi extends HttpApi.make("environment").add(
  EnvironmentHttpApi.groups.extensions,
) {}
const realAuthLayer = EnvironmentAuth.layer.pipe(
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.identityLayer),
  Layer.provide(ServerConfig.layerTest("/tmp", { prefix: "t3-extension-http-test-" })),
  Layer.provide(NodeServices.layer),
);
it.live(
  "actual HTTP authentication rejects anonymous and read-only writes before extension execution",
  () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const f = fixture([]);
      const routes = HttpApiBuilder.layer(ExtensionTestApi).pipe(
        Layer.provide(extensionsHttpApiLayer),
        Layer.provide(environmentAuthenticatedAuthLayer),
        Layer.provide(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
        Layer.provide(Layer.succeed(EnvironmentExtensions, f.service)),
        Layer.provide(NodeHttpPlatform.layer),
        Layer.provide(Etag.layer),
        Layer.provide(NodeServices.layer),
      );
      const web = yield* Effect.acquireRelease(
        Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
        (web) => Effect.promise(web.dispose),
      );
      const request = (endpoint: string, payload: unknown, token?: string) =>
        encodePayload(payload).pipe(
          Effect.flatMap((body) =>
            Effect.promise(() =>
              web.handler(
                new Request(`http://fixture/api/extensions/${endpoint}`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                  },
                  body,
                }),
              ),
            ),
          ),
        );
      const client = { id: "fixture", expectedContentHash: "a".repeat(64) };
      const invoke = {
        toolId: "fixture/read",
        input: {},
        expectedContentHash: "a".repeat(64),
        context: {
          resource: { namespace: "fixture", id: "a", environmentId: "env" },
          client: "web",
        },
      };
      const apiDiscover = {
        installationId: "fixture",
        expectedContentHash: "a".repeat(64),
        context: invoke.context,
      };
      const apiInvoke = {
        installationId: "fixture",
        expectedContentHash: "a".repeat(64),
        request: {
          id: "t3.workspace/files",
          versionRange: "^1.0.0",
          method: "listEntries",
          input: { relativePath: "" },
          context: invoke.context,
        },
      };
      const apiSelect = {
        id: "t3.workspace/files",
        providerId: "host.workspace",
        fallbackProviderIds: [],
      };
      for (const [endpoint, payload] of [
        ["list", {}],
        ["client", client],
        ["invoke", invoke],
        ["api/discover", apiDiscover],
        ["api/invoke", apiInvoke],
        ["api/select", apiSelect],
      ] as const)
        expect((yield* request(endpoint, payload)).status).toBe(401);
      expect(f.called).toEqual([]);
      const metadata = {
        deviceType: "desktop" as const,
        os: "Linux",
        browser: "fixture",
        ipAddress: "127.0.0.1",
      };
      const readGrant = yield* auth.issuePairingCredential({
        scopes: [AuthOrchestrationReadScope],
      });
      const read = yield* auth.exchangeBootstrapCredentialForAccessToken(
        readGrant.credential,
        undefined,
        metadata,
      );
      const listed = yield* request("list", {}, read.access_token);
      expect(listed.status).toBe(200);
      const listedBody = yield* Effect.promise(() => listed.text()).pipe(
        Effect.flatMap(decodeCatalogueMetadata),
      );
      expect(listedBody).toMatchObject({ supportsCatalogueChanges: true });
      expect((yield* request("client", client, read.access_token)).status).toBe(200);
      expect((yield* request("invoke", invoke, read.access_token)).status).toBe(200);
      expect(
        (yield* request(
          "install",
          { sourceDir: "/fixture", trusted: true, projectIds: [], capabilities: [] },
          read.access_token,
        )).status,
      ).toBe(403);
      for (const action of ["enable", "disable", "remove", "update", "rollback", "grants"])
        expect(
          (yield* request("manage", { id: "fixture", action }, read.access_token)).status,
        ).toBe(403);
      expect((yield* request("api/discover", apiDiscover, read.access_token)).status).toBe(200);
      expect((yield* request("api/invoke", apiInvoke, read.access_token)).status).toBe(403);
      expect((yield* request("api/select", apiSelect, read.access_token)).status).toBe(403);
      expect(f.called).toEqual(["list", "client", "invoke", "discoverApis"]);
      const writeGrant = yield* auth.issuePairingCredential({ scopes: [AuthAccessWriteScope] });
      const write = yield* auth.exchangeBootstrapCredentialForAccessToken(
        writeGrant.credential,
        undefined,
        metadata,
      );
      expect((yield* request("api/discover", apiDiscover, write.access_token)).status).toBe(403);
      expect((yield* request("api/invoke", apiInvoke, write.access_token)).status).toBe(200);
      expect((yield* request("api/select", apiSelect, write.access_token)).status).toBe(200);
      expect(f.called).toEqual([
        "list",
        "client",
        "invoke",
        "discoverApis",
        "invokeApi",
        "selectApi",
      ]);
      const adminGrant = yield* auth.issuePairingCredential({ scopes: AuthAdministrativeScopes });
      const admin = yield* auth.exchangeBootstrapCredentialForAccessToken(
        adminGrant.credential,
        undefined,
        metadata,
      );
      expect(
        (yield* request("manage", { id: "fixture", action: "disable" }, admin.access_token)).status,
      ).toBe(200);
      expect(
        (yield* request(
          "install",
          { sourceDir: "/fixture", trusted: true, projectIds: [], capabilities: [] },
          admin.access_token,
        )).status,
      ).toBe(200);
      expect(f.called).toEqual([
        "list",
        "client",
        "invoke",
        "discoverApis",
        "invokeApi",
        "selectApi",
        "manage",
        "install",
      ]);
    }).pipe(Effect.provide(realAuthLayer)),
);
