import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  type ExtensionApiInvokeInput,
  type ExtensionApiDiscoverInput,
  type ExtensionApiSelection,
  type ExtensionClientInput,
  type ExtensionInstallInput,
  type ExtensionInvokeInput,
  type ExtensionManageInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { EnvironmentExtensions } from "./EnvironmentExtensions.ts";

/** These are the actual authenticated endpoint operations, shared with focused scope tests. */
export function makeOperations(extensions: EnvironmentExtensions["Service"]) {
  return {
    invokeApi: Effect.fn("environment.extensions.invokeApi")(function* (
      input: ExtensionApiInvokeInput,
    ) {
      // Until transport grants are method-scoped, API calls require the authenticated app's write authority.
      yield* requireEnvironmentScope(AuthAccessWriteScope);
      return { result: yield* extensions.invokeApi(input) };
    }),
    discoverApis: Effect.fn("environment.extensions.discoverApis")(function* (
      input: ExtensionApiDiscoverInput,
    ) {
      yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      return { apis: yield* extensions.discoverApis(input) };
    }),
    selectApi: Effect.fn("environment.extensions.selectApi")(function* (
      input: ExtensionApiSelection,
    ) {
      yield* requireEnvironmentScope(AuthAccessWriteScope);
      yield* extensions.selectApi(input);
      return { ok: true };
    }),
    list: Effect.fn("environment.extensions.list")(function* () {
      yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      return {
        installations: yield* extensions.list,
        ...(yield* extensions.catalogue),
        supportsCatalogueChanges: true,
        supportedPackageFormats: [1, 2, 3],
        supportsApiStreams: true,
      };
    }),
    client: Effect.fn("environment.extensions.client")(function* (input: ExtensionClientInput) {
      yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      return yield* extensions.client(input.id, input.expectedContentHash);
    }),
    invoke: Effect.fn("environment.extensions.invoke")(function* (input: ExtensionInvokeInput) {
      yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      return { result: yield* extensions.invoke(input) };
    }),
    install: Effect.fn("environment.extensions.install")(function* (input: ExtensionInstallInput) {
      yield* requireEnvironmentScope(AuthAccessWriteScope);
      return yield* extensions.install(input);
    }),
    manage: Effect.fn("environment.extensions.manage")(function* (input: ExtensionManageInput) {
      yield* requireEnvironmentScope(AuthAccessWriteScope);
      return { installation: yield* extensions.manage(input) };
    }),
  };
}
export const extensionsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "extensions",
  Effect.fnUntraced(function* (handlers) {
    const operations = makeOperations(yield* EnvironmentExtensions);
    return handlers
      .handle("invokeApi", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(
          Effect.andThen(operations.invokeApi(args.payload)),
        ),
      )
      .handle("discoverApis", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(
          Effect.andThen(operations.discoverApis(args.payload)),
        ),
      )
      .handle("selectApi", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(
          Effect.andThen(operations.selectApi(args.payload)),
        ),
      )
      .handle("list", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(Effect.andThen(operations.list())),
      )
      .handle("client", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(
          Effect.andThen(operations.client(args.payload)),
        ),
      )
      .handle("invoke", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(
          Effect.andThen(operations.invoke(args.payload)),
        ),
      )
      .handle("install", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(
          Effect.andThen(operations.install(args.payload)),
        ),
      )
      .handle("manage", (args) =>
        annotateEnvironmentRequest(args.endpoint.name).pipe(
          Effect.andThen(operations.manage(args.payload)),
        ),
      );
  }),
);
