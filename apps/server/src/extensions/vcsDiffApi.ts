// @effect-diagnostics nodeBuiltinImport:off - the delivered-payload hash is recomputed in a pure mapper outside a service context.
import { AuthOrchestrationReadScope, ExtensionOperationError } from "@t3tools/contracts";
import {
  VCS_DIFF_API,
  type VcsDiffFileContentsResult,
  type VcsDiffPreviewResult,
  type VcsDiffPreviewSource,
} from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type {
  HostApiInvocationMetadata,
  HostApiPrincipal,
  HostApiProvider,
} from "@t3tools/extension-runtime";
import * as DateTime from "effect/DateTime";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { ReviewService } from "../review/ReviewService.ts";
import { makeExtensionScopeResolver } from "./scope.ts";

/**
 * The public `diff` bound (512 000 chars) sits below the native joined cap
 * (≤120 KB tracked patch + ≤80 KB per untracked file); the adapter slices
 * and ORs `truncated` rather than fabricating a complete diff.
 */
const MAX_DIFF_CHARS = 512_000;
const MAX_FILE_CONTENTS_CHARS = 1_048_576;

const pathSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
/**
 * Revspecs reach `git diff`/`git show` argv — a leading `-` would inject
 * options (`--output=` escapes the workspace), and whitespace/control
 * characters are never valid. Mirrors the contract-side not-patterns.
 */
const revSpecSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  // eslint-disable-next-line no-control-regex -- revspecs legitimately reject control characters.
  Schema.isPattern(/^(?!-)[^\s\x00-\x1f]+$/u),
);
const previewInput = Schema.decodeUnknownSync(
  Schema.Struct({
    baseRef: Schema.optional(revSpecSchema),
    ignoreWhitespace: Schema.optional(Schema.Boolean),
  }),
  { onExcessProperty: "error" },
);
const fileContentsInput = Schema.decodeUnknownSync(
  Schema.Struct({
    sourceKind: Schema.Literals(["working-tree", "branch-range"]),
    changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
    baseRef: Schema.NullOr(revSpecSchema),
    headRef: Schema.NullOr(revSpecSchema),
    oldPath: pathSchema,
    newPath: pathSchema,
  }),
  { onExcessProperty: "error" },
);

const failure = (detail: string) => new ExtensionOperationError({ operation: "vcs.diff", detail });
const isOperationError = Schema.is(ExtensionOperationError);

const operationError = (cause: unknown) => {
  if (isOperationError(cause)) return cause;
  const tag =
    cause !== null &&
    typeof cause === "object" &&
    "_tag" in cause &&
    typeof (cause as { _tag: unknown })._tag === "string"
      ? (cause as { _tag: string })._tag
      : cause instanceof Error
        ? cause.name
        : undefined;
  const message = cause instanceof Error ? cause.message : "VCS diff operation failed.";
  return failure(`${tag ? `${tag}: ` : ""}${message}`.slice(0, 512));
};

const toPublicSource = (source: {
  readonly id: string;
  readonly kind: "working-tree" | "branch-range";
  readonly title: string;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly diff: string;
  readonly diffHash: string;
  readonly truncated: boolean;
}): VcsDiffPreviewSource => {
  const diff = source.diff.slice(0, MAX_DIFF_CHARS);
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    baseRef: source.baseRef,
    headRef: source.headRef,
    diff,
    // The hash must describe the payload as delivered — the native hash
    // covers the pre-slice text, so recompute over the bounded body.
    diffHash: NodeCrypto.createHash("sha256").update(diff).digest("hex"),
    truncated: source.truncated || source.diff.length > MAX_DIFF_CHARS,
  };
};

export function createVcsDiffApiProvider(
  dependencies: Parameters<typeof makeExtensionScopeResolver>[0] & {
    readonly review: Pick<ReviewService["Service"], "getDiffPreview" | "getDiffFileContents">;
  },
): HostApiProvider {
  const resolve = makeExtensionScopeResolver(dependencies);
  const authorized = (principal: HostApiPrincipal | undefined) =>
    principal !== undefined &&
    principal.environmentId === dependencies.environmentId &&
    principal.scopes.includes(AuthOrchestrationReadScope);

  const invoke = Effect.fn("VcsDiffApi.invoke")(function* (
    method: string,
    input: unknown,
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
  ) {
    signal.throwIfAborted();
    if (!authorized(metadata.principal)) {
      return yield* failure("VCS authority is unavailable.");
    }
    const scope = yield* resolve(context);
    let result: VcsDiffPreviewResult | VcsDiffFileContentsResult;
    if (method === "getPreview") {
      const safe = yield* Effect.try({
        try: () => previewInput(input),
        catch: () => failure("Invalid VCS diff preview request."),
      });
      const preview = yield* dependencies.review
        .getDiffPreview({
          cwd: scope.cwd,
          ...(safe.baseRef === undefined ? {} : { baseRef: safe.baseRef }),
          ...(safe.ignoreWhitespace === undefined
            ? {}
            : { ignoreWhitespace: safe.ignoreWhitespace }),
        })
        .pipe(Effect.mapError(operationError));
      result = {
        generatedAt: DateTime.formatIso(preview.generatedAt),
        sources: preview.sources.map(toPublicSource),
      };
    } else if (method === "getFileContents") {
      const safe = yield* Effect.try({
        try: () => fileContentsInput(input),
        catch: () => failure("Invalid VCS diff file contents request."),
      });
      const contents = yield* dependencies.review
        .getDiffFileContents({ cwd: scope.cwd, ...safe })
        .pipe(Effect.mapError(operationError));
      if (
        contents.oldContents.length > MAX_FILE_CONTENTS_CHARS ||
        contents.newContents.length > MAX_FILE_CONTENTS_CHARS
      ) {
        return yield* failure("VCS diff file contents exceed the public bounds.");
      }
      result = { oldContents: contents.oldContents, newContents: contents.newContents };
    } else {
      return yield* failure("VCS diff API method is unavailable.");
    }
    yield* Effect.tryPromise({
      try: () => metadata.assertAuthority?.() ?? Promise.resolve(),
      catch: () => failure("VCS authority was revoked."),
    });
    yield* resolve(scope.context);
    signal.throwIfAborted();
    return result;
  });

  return {
    providerId: "t3.host-vcs-diff",
    definition: VCS_DIFF_API,
    requiresRootAuthority: true,
    invoke: (method, input, context, signal, metadata) =>
      Effect.runPromise(invoke(method, input, context, signal, metadata), { signal }),
  };
}

export const makeVcsDiffApiProvider = Effect.fn("VcsDiffApi.make")(function* () {
  const environment = yield* ServerEnvironment;
  return createVcsDiffApiProvider({
    environmentId: yield* environment.getEnvironmentId,
    projects: yield* ProjectionProjectRepository,
    threads: yield* ProjectionThreadRepository,
    review: yield* ReviewService,
  });
});
