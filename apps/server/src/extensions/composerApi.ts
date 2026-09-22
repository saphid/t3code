import { ClientProvidersError, ExtensionOperationError } from "@t3tools/contracts";
import { COMPOSER_CONTEXT_API, MESSAGES_ENRICHMENT_API } from "@t3tools/extension-sdk/catalogue";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiInvocationMetadata, HostApiProvider } from "@t3tools/extension-runtime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import type { ClientApiProviders } from "./ClientApiProviders.ts";
import { invokeClient } from "./uiClientApis.ts";
import { makeExtensionScopeResolver } from "./scope.ts";

/**
 * The composer draft store is client-local (apps/web zustand state); these
 * adapters forward ops to the `t3.client/composer` provider over the
 * client-provider connect stream. When no client connection hosts the
 * provider, `getCapabilities` reports `transport: "unavailable"` and ops
 * fail `client-provider-unavailable` rather than silently no-opping.
 * Composer ops are ScopedThreadRef-only: drafts are written for the
 * context's own thread, never a client-local `DraftId`.
 */
const CLIENT_COMPOSER = "t3.client/composer";
const COMPOSER_TIMEOUT_MS = 10_000;

const failure = (operation: string, detail: string) =>
  new ExtensionOperationError({ operation, detail: detail.slice(0, 512) });

/** Forwarded client errors keep their `client-*`/`notification-*` code prefix in the detail. */
const clientFailure = (operation: string) => (cause: unknown) =>
  Schema.is(ClientProvidersError)(cause)
    ? failure(operation, `${cause.code}: ${cause.detail}`)
    : failure(operation, cause instanceof Error ? cause.message : String(cause));

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
        excerpt: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
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
      body: boundedString(4096),
      excerpt: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
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

export interface ComposerBridge {
  readonly environmentId: string;
  readonly clientApiProviders: ClientApiProviders["Service"];
}

/** Dependencies remain host-owned; callers supply only a scoped resource and bounded payloads. */
export function createComposerApiProviders(
  dependencies: Parameters<typeof makeExtensionScopeResolver>[0],
  bridge: ComposerBridge,
): readonly HostApiProvider[] {
  const resolve = makeExtensionScopeResolver(dependencies);

  const transport = Effect.gen(function* () {
    const available = yield* bridge.clientApiProviders.hasProvider(
      bridge.environmentId,
      CLIENT_COMPOSER,
    );
    return { available };
  });
  const composerCapabilities = (adapter: string, operations: Record<string, boolean>) =>
    Effect.map(transport, ({ available }) => {
      const ops = Object.fromEntries(Object.keys(operations).map((name) => [name, available]));
      return {
        adapter,
        transport: available ? "client" : "unavailable",
        detail: available
          ? null
          : "Composer draft state is client-local; no connected client hosts the composer provider.",
        operations: ops,
      } satisfies Json;
    });

  const forward = (
    method: string,
    input: Json,
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
  ) =>
    Effect.runPromise(
      invokeClient(bridge, {
        apiId: CLIENT_COMPOSER,
        method,
        input,
        context,
        metadata,
        signal,
        timeoutMs: COMPOSER_TIMEOUT_MS,
      }),
      { signal },
    );

  const composerInvoke = Effect.fn("ComposerApi.invoke")(function* (
    method: string,
    input: unknown,
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
  ) {
    const scope = yield* resolve(context);
    if (method === "getCapabilities") {
      yield* resolve(scope.context);
      return yield* composerCapabilities("host.composer", {
        insertContext: true,
        getDraftState: true,
      });
    }
    const operation = `composer.context.${method}`;
    if (method === "insertContext") {
      const safe = yield* Effect.try({
        try: () => insertInput(input),
        catch: invalid(operation),
      });
      const threadId = yield* scopedThread(operation, safe.threadId, scope.context);
      yield* resolve(scope.context);
      return yield* Effect.tryPromise({
        try: () =>
          forward(
            "insertContext",
            { threadId, refs: safe.refs } as Json,
            scope.context,
            signal,
            metadata,
          ),
        catch: clientFailure(operation),
      });
    }
    if (method === "getDraftState") {
      const safe = yield* Effect.try({
        try: () => draftInput(input),
        catch: invalid(operation),
      });
      const threadId = yield* scopedThread(operation, safe.threadId, scope.context);
      yield* resolve(scope.context);
      return yield* Effect.tryPromise({
        try: () => forward("getDraftState", { threadId } as Json, scope.context, signal, metadata),
        catch: clientFailure(operation),
      });
    }
    return yield* failure("composer.context", "Composer context API method is unavailable.");
  });

  const enrichmentInvoke = Effect.fn("ComposerApi.invokeEnrichment")(function* (
    method: string,
    input: unknown,
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
  ) {
    const scope = yield* resolve(context);
    if (method === "getCapabilities") {
      yield* resolve(scope.context);
      return yield* composerCapabilities("host.messages", { attachAnnotation: true });
    }
    const operation = `messages.enrichment.${method}`;
    if (method === "attachAnnotation") {
      const safe = yield* Effect.try({
        try: () => annotationInput(input),
        catch: invalid(operation),
      });
      const threadId = yield* scopedThread(operation, safe.threadId, scope.context);
      yield* resolve(scope.context);
      return yield* Effect.tryPromise({
        try: () =>
          forward(
            "attachAnnotation",
            { threadId, annotation: safe.annotation } as Json,
            scope.context,
            signal,
            metadata,
          ),
        catch: clientFailure(operation),
      });
    }
    return yield* failure("messages.enrichment", "Messages enrichment API method is unavailable.");
  });

  return [
    {
      providerId: "host.composer",
      definition: COMPOSER_CONTEXT_API,
      availability: async () =>
        (await Effect.runPromise(
          bridge.clientApiProviders.hasProvider(bridge.environmentId, CLIENT_COMPOSER),
        ))
          ? { status: "ready" }
          : {
              status: "unavailable",
              reason: {
                code: "client-provider-unavailable",
                detail: "No connected client registered this provider.",
                relatedIds: [],
              },
            },
      invoke: (method: string, input: Json, context: ViewContext, signal: AbortSignal, metadata) =>
        Effect.runPromise(composerInvoke(method, input, context, signal, metadata), { signal }),
    },
    {
      providerId: "host.messages",
      definition: MESSAGES_ENRICHMENT_API,
      availability: async () =>
        (await Effect.runPromise(
          bridge.clientApiProviders.hasProvider(bridge.environmentId, CLIENT_COMPOSER),
        ))
          ? { status: "ready" }
          : {
              status: "unavailable",
              reason: {
                code: "client-provider-unavailable",
                detail: "No connected client registered this provider.",
                relatedIds: [],
              },
            },
      invoke: (method: string, input: Json, context: ViewContext, signal: AbortSignal, metadata) =>
        Effect.runPromise(enrichmentInvoke(method, input, context, signal, metadata), { signal }),
    },
  ];
}

export const makeComposerApiProviders = Effect.fn("ComposerApi.make")(function* (
  bridge: ComposerBridge,
) {
  return createComposerApiProviders(
    {
      environmentId: bridge.environmentId,
      projects: yield* ProjectionProjectRepository,
      threads: yield* ProjectionThreadRepository,
    },
    bridge,
  );
});
