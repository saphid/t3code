import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
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
    list: Effect.fn("environment.extensions.list")(function* () {
      yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      return { installations: yield* extensions.list };
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
