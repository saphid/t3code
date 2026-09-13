import { ExtensionOperationError } from "@t3tools/contracts";
import { COMPOSER_CONTEXT_API, MESSAGES_ENRICHMENT_API } from "@t3tools/extension-sdk/catalogue";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiProvider } from "@t3tools/extension-runtime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { makeExtensionScopeResolver } from "./scope.ts";

/**
 * The composer draft store is client-local (apps/web zustand state) and no
 * client-adapter invocation transport exists for installed APIs. These
 * providers therefore carry the contract's honest surface: capability
 * discovery reports the transport gap, and the state ops decode + scope-check
 * fully, then fail with a named error rather than silently no-opping. The
 * contracts are frozen at 1.0.0 so the ops fill in behind the same schemas
 * when a client adapter lands.
 */
const transportDetail =
  "Composer draft state is client-local; no client-adapter invocation transport exists for installed APIs.";

const failure = (operation: string, detail: string) =>
  new ExtensionOperationError({ operation, detail: detail.slice(0, 512) });

const unsupported = (operation: string) =>
  failure(operation, `${operation} is unavailable: ${transportDetail}`);

const boundedString = (max: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const lineSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }));
const threadIdField = { threadId: Schema.optional(boundedString(128)) } as const;

const insertInput = Schema.decodeUnknownSync(
  Schema.Struct({
    ...threadIdField,
    refs: Schema.Array(
      Schema.Struct({
        path: boundedString(512),
        startLine: Schema.optional(lineSchema),
        endLine: Schema.optional(lineSchema),
        excerpt: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  }),
  { onExcessProperty: "error" },
);
const draftInput = Schema.decodeUnknownSync(Schema.Struct({ ...threadIdField }), {
  onExcessProperty: "error",
});
const annotationInput = Schema.decodeUnknownSync(
  Schema.Struct({
    ...threadIdField,
    annotation: Schema.Struct({
      filePath: boundedString(512),
      startLine: lineSchema,
      endLine: lineSchema,
      body: boundedString(8192),
      excerpt: Schema.optional(Schema.String.check(Schema.isMaxLength(32768))),
    }),
  }),
  { onExcessProperty: "error" },
);

/** Draft ops address the calling surface's own thread only — `ScopedThreadRef`, never a client-local `DraftId`. */
const scopedThread = (
  operation: string,
  threadId: string | undefined,
  context: ViewContext,
): Effect.Effect<string, ExtensionOperationError> => {
  const scoped = context.resource.threadId;
  if (threadId !== undefined && threadId !== scoped)
    return Effect.fail(failure(operation, "Draft target is outside the granted thread scope."));
  const target = threadId ?? scoped;
  if (!target)
    return Effect.fail(failure(operation, "Draft operations require a thread-scoped context."));
  return Effect.succeed(target);
};

const invalid = (operation: string) => () =>
  failure(operation, "Invalid composer operation request.");

/** Dependencies remain host-owned; callers supply only a scoped resource and bounded payloads. */
export function createComposerApiProviders(
  dependencies: Parameters<typeof makeExtensionScopeResolver>[0],
): readonly HostApiProvider[] {
  const resolve = makeExtensionScopeResolver(dependencies);

  const composerInvoke = Effect.fn("ComposerApi.invoke")(function* (
    method: string,
    input: unknown,
    context: ViewContext,
  ) {
    const scope = yield* resolve(context);
    if (method === "getCapabilities") {
      yield* resolve(scope.context);
      return {
        adapter: "host.composer",
        transport: "unavailable",
        detail: transportDetail,
        operations: { insertContext: false, getDraftState: false },
      } satisfies Json;
    }
    const operation = `composer.context.${method}`;
    if (method === "insertContext") {
      const safe = yield* Effect.try({
        try: () => insertInput(input),
        catch: invalid(operation),
      });
      yield* scopedThread(operation, safe.threadId, scope.context);
      yield* resolve(scope.context);
      return yield* unsupported(operation);
    }
    if (method === "getDraftState") {
      const safe = yield* Effect.try({
        try: () => draftInput(input),
        catch: invalid(operation),
      });
      yield* scopedThread(operation, safe.threadId, scope.context);
      yield* resolve(scope.context);
      return yield* unsupported(operation);
    }
    return yield* failure("composer.context", "Composer context API method is unavailable.");
  });

  const enrichmentInvoke = Effect.fn("ComposerApi.invokeEnrichment")(function* (
    method: string,
    input: unknown,
    context: ViewContext,
  ) {
    const scope = yield* resolve(context);
    if (method === "getCapabilities") {
      yield* resolve(scope.context);
      return {
        adapter: "host.messages",
        transport: "unavailable",
        detail: transportDetail,
        operations: { attachAnnotation: false },
      } satisfies Json;
    }
    const operation = `messages.enrichment.${method}`;
    if (method === "attachAnnotation") {
      const safe = yield* Effect.try({
        try: () => annotationInput(input),
        catch: invalid(operation),
      });
      yield* scopedThread(operation, safe.threadId, scope.context);
      yield* resolve(scope.context);
      return yield* unsupported(operation);
    }
    return yield* failure("messages.enrichment", "Messages enrichment API method is unavailable.");
  });

  return [
    {
      providerId: "host.composer",
      definition: COMPOSER_CONTEXT_API,
      invoke: (
        method: string,
        input: Json,
        context: ViewContext,
        signal: AbortSignal,
      ): Promise<Json> => Effect.runPromise(composerInvoke(method, input, context), { signal }),
    },
    {
      providerId: "host.messages",
      definition: MESSAGES_ENRICHMENT_API,
      invoke: (
        method: string,
        input: Json,
        context: ViewContext,
        signal: AbortSignal,
      ): Promise<Json> => Effect.runPromise(enrichmentInvoke(method, input, context), { signal }),
    },
  ];
}

export const makeComposerApiProviders = Effect.fn("ComposerApi.make")(function* () {
  const environment = yield* ServerEnvironment;
  return createComposerApiProviders({
    environmentId: yield* environment.getEnvironmentId,
    projects: yield* ProjectionProjectRepository,
    threads: yield* ProjectionThreadRepository,
  });
});
