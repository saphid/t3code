// @effect-diagnostics nodeBuiltinImport:off - delivered-payload hashes are recomputed in pure mappers outside a service context.
import {
  AuthOrchestrationReadScope,
  ExtensionOperationError,
  ProjectId,
  type PullRequestActivity as NativePullRequestActivity,
  type PullRequestDetail as NativePullRequestDetail,
  type PullRequestListResult as NativePullRequestListResult,
  type PullRequestRef as NativePullRequestRef,
} from "@t3tools/contracts";
import {
  PRS_READ_API,
  type PrsActivity,
  type PrsCapabilitiesResult,
  type PrsComment,
  type PrsCommit,
  type PrsDetail,
  type PrsDiffStreamEvent,
  type PrsLabelCandidateList,
  type PrsLinkedThreadsResult,
  type PrsListResult,
  type PrsListStatsResult,
  type PrsOperationsSupport,
  type PrsRefreshedEvent,
  type PrsReviewThread,
  type PrsReviewerCandidateList,
  type PrsStack,
  type PrsSummary,
  type PrsThreadCommentsResult,
  type VcsDiffFileContentsStreamEvent,
} from "@t3tools/extension-sdk/catalogue";
import type { ApiStreamEvent } from "@t3tools/extension-sdk/capabilities";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type {
  HostApiInvocationMetadata,
  HostApiPrincipal,
  HostApiProvider,
} from "@t3tools/extension-runtime";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PullRequestService, type PullRequestError } from "../../pullRequest/PullRequestService.ts";
import type { PullRequestProviderApi } from "../../pullRequest/PullRequestProvider.ts";
import { PullRequestProviderRegistry } from "../../pullRequest/PullRequestProviderRegistry.ts";
import { listLinkedPullRequestThreads } from "../../pullRequest/linkedThreads.ts";
import { pullRequestSyncKey } from "../../pullRequest/pullRequestSyncKey.ts";
import { makeExtensionScopeResolver } from "../scope.ts";

/**
 * Public bounds the adapter enforces server-side, again — the broker's ajv
 * pass validates first, and these Effect decoders add
 * `onExcessProperty: "error"`. Output bounds keep a unary result inside the
 * broker's 64 KiB envelope: collections are cut from the tail and the result
 * flagged `truncated`, never silently reduced.
 */
const MAX_RESULT_BYTES = 48 * 1024;
const MAX_DETAIL_BODY_CHARS = 16_384;
const MAX_COMMENT_BODY_CHARS = 8_192;
const MAX_ACTIVITY_COMMENTS = 100;
const MAX_ACTIVITY_THREADS = 100;
const MAX_ACTIVITY_COMMITS = 250;
const MAX_THREAD_COMMENTS = 100;
const MAX_CANDIDATES = 200;
const MAX_LABEL_CANDIDATES = 500;
const MAX_LINKED_THREADS = 200;
const MAX_LIST_ENTRIES = 100;
/** Whole-patch delivery bound for `streamDiff` (UTF-16 units) — 512 chunks. */
const MAX_DIFF_STREAM_UNITS = 4 * 1024 * 1024;
const MAX_FILE_CONTENTS_CHARS = 1_048_576;
/** Contract chunk bound (UTF-16 units), same as t3.vcs/diff@1.1.0. */
const STREAM_CHUNK_UNITS = 8_192;
const STREAM_FRAME_BUDGET = 64 * 1024;

const string256 = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const hostField = Schema.optional(string256);
const repositoryField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const refFields = {
  host: hostField,
  repository: repositoryField,
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
} as const;
const decode = <A, I>(schema: Schema.Codec<A, I>) =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" });
const emptyInput = decode(Schema.Struct({}));
const refInput = decode(Schema.Struct(refFields));
const listInput = decode(
  Schema.Struct({
    state: Schema.Literals(["all", "open", "closed", "merged"]),
    involvement: Schema.optional(Schema.Literals(["all", "reviewing", "authored"])),
    filters: Schema.optional(
      Schema.Struct({
        draft: Schema.optional(Schema.Literals(["only", "hide"])),
        review: Schema.optional(
          Schema.Literals(["approved", "changes-requested", "review-required", "none"]),
        ),
        checks: Schema.optional(Schema.Literals(["passing", "failing"])),
        labels: Schema.optional(
          Schema.Array(
            Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).check(
              Schema.isMaxLength(10),
            ),
          ).check(Schema.isMaxLength(10)),
        ),
        excludedLabels: Schema.optional(
          Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).check(
            Schema.isMaxLength(10),
          ),
        ),
        author: Schema.optional(
          Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
        ),
      }),
    ),
    host: hostField,
    limit: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)),
    ),
    cursors: Schema.optional(
      Schema.Record(
        Schema.String,
        Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
      ),
    ),
    query: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  }),
);
const listStatsInput = decode(
  Schema.Struct({
    refs: Schema.Array(Schema.Struct(refFields)).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(100),
    ),
  }),
);
const threadCommentsInput = decode(
  Schema.Struct({
    ...refFields,
    threadId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
    cursor: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  }),
);
const invalidateInput = decode(
  Schema.Struct({ reference: Schema.optional(Schema.Struct(refFields)) }),
);
const diffInput = decode(
  Schema.Struct({
    ...refFields,
    commit: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
    cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
  }),
);
const diffFileContentsInput = decode(
  Schema.Struct({
    ...refFields,
    commit: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
    changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
    oldPath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
    newPath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  }),
);

const failure = (operation: string, detail: string) =>
  new ExtensionOperationError({ operation, detail });

const isOperationError = Schema.is(ExtensionOperationError);

/**
 * Tag-preserving mapping — a `PullRequestUnavailableError` keeps its name so
 * cli-missing / cli-unauthenticated / provider-unsupported are observable by
 * name, not flattened into a generic "failed".
 */
const operationError = (operation: string) => (cause: unknown) => {
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
  // `PullRequestUnavailableError` carries the stable reason callers act on —
  // cli-missing / cli-unauthenticated / provider-unsupported — so it is named
  // in the detail, not just the tag.
  const reason =
    cause !== null &&
    typeof cause === "object" &&
    "reason" in cause &&
    typeof (cause as { reason: unknown }).reason === "string"
      ? (cause as { reason: string }).reason
      : undefined;
  const message = cause instanceof Error ? cause.message : "Pull request operation failed.";
  const label = tag === undefined ? "" : reason === undefined ? `${tag}: ` : `${tag}(${reason}): `;
  return failure(operation, `${label}${message}`.slice(0, 512));
};

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const capBody = (body: string, bound = MAX_COMMENT_BODY_CHARS) =>
  body.length <= bound ? { body, cut: false } : { body: body.slice(0, bound), cut: true };

/** Same surrogate-safe splitting the vcs diff streams use. */
const splitStreamChunks = (data: string): string[] => {
  const chunks: string[] = [];
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + STREAM_CHUNK_UNITS, data.length);
    if (end < data.length) {
      const previous = data.charCodeAt(end - 1);
      const next = data.charCodeAt(end);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        end -= 1;
      }
    }
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
};

const assertStreamFrameFits = (operation: string, value: object) => {
  if (
    Buffer.byteLength(
      JSON.stringify({
        streamId: "x".repeat(128),
        sequence: Number.MAX_SAFE_INTEGER,
        type: "snapshot",
        value,
      }),
      "utf8",
    ) > STREAM_FRAME_BUDGET
  ) {
    throw failure(operation, "Pull request stream event exceeds encoded frame bounds.");
  }
};

const NO_PR_OPERATIONS: PrsOperationsSupport = {
  "prs.list": false,
  "prs.listStats": false,
  "prs.summary": false,
  "prs.detail": false,
  "prs.activity": false,
  "prs.threadComments": false,
  // Environment-local answers — a link query and a cache clear succeed on a
  // local-only repository, and the refresh stream exists regardless of host.
  "prs.linkedThreads": true,
  "prs.stack": false,
  "prs.reviewerCandidates": false,
  "prs.labelCandidates": false,
  "prs.invalidate": true,
  "prs.streamDiff": false,
  "prs.streamDiffFileContents": false,
  "prs.subscribeRefreshes": true,
};

const operationsSupport = (apis: ReadonlyArray<PullRequestProviderApi>): PrsOperationsSupport => {
  const configured = apis.length > 0;
  return {
    ...NO_PR_OPERATIONS,
    "prs.list": configured,
    "prs.listStats": configured,
    "prs.summary": configured,
    "prs.detail": configured,
    "prs.activity": configured,
    "prs.threadComments": apis.some((api) => api.getReviewThreadComments !== undefined),
    // The service answers null where the host keeps no stack objects; the
    // flag still reports whether stacks can ever carry data.
    "prs.stack": apis.some((api) => api.getChangeRequestStack !== undefined),
    "prs.reviewerCandidates": apis.some(
      (api) => api.capabilities.reviewers.listCandidates === true,
    ),
    "prs.labelCandidates": apis.some((api) => api.capabilities.labels === true),
    "prs.streamDiff": apis.some((api) => api.capabilities.diff),
    "prs.streamDiffFileContents": apis.some(
      (api) => api.capabilities.diff && api.getDiffFileContents !== undefined,
    ),
  };
};

interface ScopeDependencies {
  readonly environmentId: string;
  readonly projects: Parameters<typeof makeExtensionScopeResolver>[0]["projects"];
  readonly threads: Parameters<typeof makeExtensionScopeResolver>[0]["threads"];
}

interface PrsApiDependencies extends ScopeDependencies {
  readonly pullRequests: Pick<
    PullRequestService["Service"],
    | "list"
    | "listStats"
    | "summary"
    | "stack"
    | "detail"
    | "activity"
    | "threadComments"
    | "diff"
    | "diffFileContents"
    | "reviewerCandidates"
    | "labelCandidates"
    | "invalidate"
    | "subscribeRefreshes"
  >;
  readonly prRegistry: Pick<PullRequestProviderRegistry["Service"], "get">;
  readonly projectionSnapshotQuery: Pick<ProjectionSnapshotQuery["Service"], "getProjectShellById">;
  readonly sql: SqlClient.SqlClient;
}

type Scope = Effect.Success<ReturnType<ReturnType<typeof makeExtensionScopeResolver>>>;
type MethodHandler = (call: {
  readonly input: unknown;
  readonly context: ViewContext;
  readonly signal: AbortSignal;
  readonly metadata: HostApiInvocationMetadata;
}) => Effect.Effect<Json, ExtensionOperationError>;

export function createPrsApiProvider(dependencies: PrsApiDependencies): HostApiProvider {
  const resolve = makeExtensionScopeResolver(dependencies);
  const authorized = (principal: HostApiPrincipal | undefined) =>
    principal !== undefined &&
    principal.environmentId === dependencies.environmentId &&
    principal.scopes.includes(AuthOrchestrationReadScope);

  const projectIdOf = (scope: Scope) => ProjectId.make(scope.context.resource.projectId!);

  /** A public `PrsRef` becomes the native `PullRequestRef` with the scoped project injected. */
  const nativeRef = (
    scope: Scope,
    ref: {
      readonly host?: string | undefined;
      readonly repository: string;
      readonly number: number;
    },
  ) =>
    ({
      projectId: projectIdOf(scope),
      ...(ref.host === undefined ? {} : { host: ref.host }),
      repository: ref.repository,
      number: ref.number,
    }) satisfies NativePullRequestRef;

  /**
   * A reference's host-level link key; the project's own host where the ref
   * names none. Same derivation as the ws handler, so `linkedThreads` answers
   * the same threads the native surface would.
   */
  const resolveSyncKey = (ref: NativePullRequestRef) =>
    ref.host !== undefined && ref.repository.includes("/")
      ? Effect.succeed(pullRequestSyncKey(ref))
      : dependencies.projectionSnapshotQuery.getProjectShellById(ref.projectId).pipe(
          Effect.map((project) =>
            pullRequestSyncKey(ref, Option.getOrUndefined(project)?.repositoryIdentity),
          ),
          Effect.orElseSucceed(() => null),
        );

  /**
   * Delivered results must fit the invoke envelope. Collections are cut from
   * the tail until the serialized answer fits; `nextCursors` are dropped when
   * entries were cut, because those cursors describe positions past rows the
   * caller never saw — resuming from them would silently skip PRs.
   *
   * Public DTOs are the native shapes minus `| undefined` members:
   * exactOptionalPropertyTypes gives every `Schema.optional` field a
   * `?: T | undefined` declaration the `Json` union cannot carry, and
   * `undefined` never survives the broker's copyJson round-trip. The `as`
   * casts below record that identity; the api's own outputSchema validates
   * every result on the way out.
   */
  const boundList = (result: NativePullRequestListResult): PrsListResult => {
    let entries = result.entries.slice(0, MAX_LIST_ENTRIES);
    while (entries.length > 0 && byteLength({ ...result, entries }) > MAX_RESULT_BYTES) {
      entries = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
    }
    const cut = entries.length < result.entries.length;
    return {
      ...result,
      entries,
      ...(cut ? { truncated: true, nextCursors: {} } : {}),
    } as PrsListResult;
  };

  const boundActivity = (result: NativePullRequestActivity): PrsActivity => {
    let truncated = false;
    const capComment = <T extends { readonly body: string }>(comment: T): T => {
      const { body, cut } = capBody(comment.body);
      if (cut) truncated = true;
      return cut ? { ...comment, body } : comment;
    };
    let comments = result.comments
      .slice(0, MAX_ACTIVITY_COMMENTS)
      .map(capComment) as readonly PrsComment[];
    let commentsTruncated = result.commentsTruncated || comments.length < result.comments.length;
    if (commentsTruncated) truncated = true;
    let reviewThreads = result.reviewThreads.slice(0, MAX_ACTIVITY_THREADS).map((thread) => ({
      ...thread,
      comments: thread.comments.map(capComment),
    })) as readonly PrsReviewThread[];
    let commits = result.commits.slice(0, MAX_ACTIVITY_COMMITS) as readonly PrsCommit[];
    if (
      reviewThreads.length < result.reviewThreads.length ||
      commits.length < result.commits.length
    )
      truncated = true;
    const assembled = (): PrsActivity => ({
      ...(result.author === undefined ? {} : { author: result.author }),
      ...(result.reviewers === undefined ? {} : { reviewers: result.reviewers }),
      comments,
      commentCount: result.commentCount,
      commentsTruncated,
      reviewThreads,
      commits,
      ...(result.reactions === undefined ? {} : { reactions: result.reactions }),
      truncated,
    });
    let next = assembled() as PrsActivity;
    // A pathological conversation (a hundred near-bound bodies) still has to
    // fit the envelope; drop the oldest-heavy tails before failing it.
    while (byteLength(next) > MAX_RESULT_BYTES && commits.length > 0) {
      commits = commits.slice(0, Math.max(1, Math.floor(commits.length / 2)));
      truncated = true;
      next = assembled();
    }
    while (byteLength(next) > MAX_RESULT_BYTES && reviewThreads.length > 0) {
      reviewThreads = reviewThreads.slice(0, Math.max(1, Math.floor(reviewThreads.length / 2)));
      truncated = true;
      next = assembled();
    }
    while (byteLength(next) > MAX_RESULT_BYTES && comments.length > 0) {
      comments = comments.slice(0, Math.max(1, Math.floor(comments.length / 2)));
      commentsTruncated = true;
      truncated = true;
      next = assembled();
    }
    return next;
  };

  const boundDetail = (detail: NativePullRequestDetail): PrsDetail => {
    const { body, cut } = capBody(detail.body, MAX_DETAIL_BODY_CHARS);
    return (cut ? { ...detail, body, bodyTruncated: true } : detail) as PrsDetail;
  };

  const boundThreadComments = <
    T extends { readonly comments: ReadonlyArray<{ readonly body: string }> },
  >(
    result: T,
  ): T => ({
    ...result,
    comments: result.comments
      .slice(0, MAX_THREAD_COMMENTS)
      .map((comment) => ({ ...comment, body: capBody(comment.body).body })),
  });

  const boundCandidates = <T extends { readonly candidates: ReadonlyArray<unknown> }>(
    result: T,
    bound: number,
  ): T => {
    const candidates = result.candidates.slice(0, bound);
    return candidates.length < result.candidates.length
      ? { ...result, candidates, truncated: true }
      : { ...result, candidates };
  };

  const boundLinkedThreads = <T extends { readonly threads: ReadonlyArray<unknown> }>(
    result: T,
  ): T => ({ ...result, threads: result.threads.slice(0, MAX_LINKED_THREADS) });

  const runMethod = <Input, Output extends Json>(args: {
    readonly operation: string;
    readonly decode: (input: unknown) => Input;
    readonly run: (safe: Input, scope: Scope) => Effect.Effect<Output, PullRequestError>;
  }): MethodHandler =>
    Effect.fn("PrsApi.invoke")(function* ({ input, context, signal, metadata }) {
      signal.throwIfAborted();
      if (!authorized(metadata.principal)) {
        return yield* failure(args.operation, "Pull request authority is unavailable.");
      }
      const safe = yield* Effect.try({
        try: () => args.decode(input),
        catch: () => failure(args.operation, "Invalid pull request request input."),
      });
      const scope = yield* resolve(context);
      const result = yield* args
        .run(safe, scope)
        .pipe(Effect.mapError(operationError(args.operation)));
      yield* Effect.tryPromise({
        try: () => metadata.assertAuthority?.() ?? Promise.resolve(),
        catch: () => failure(args.operation, "Pull request authority was revoked."),
      });
      yield* resolve(scope.context);
      signal.throwIfAborted();
      return result;
    });

  const invokeProvider =
    (operations: Record<string, MethodHandler>) =>
    (
      method: string,
      input: unknown,
      context: ViewContext,
      signal: AbortSignal,
      metadata: HostApiInvocationMetadata,
    ) => {
      const handler = operations[method];
      if (!handler)
        return Effect.runPromise(
          Effect.fail(failure(`prs.${method}`, "Pull request API method is unavailable.")),
          { signal },
        );
      return Effect.runPromise(handler({ input, context, signal, metadata }), { signal });
    };

  const streamDiff = Effect.fn("PrsApi.streamDiff")(function* (
    safe: {
      readonly host?: string | undefined;
      readonly repository: string;
      readonly number: number;
      readonly commit?: string | undefined;
      readonly cursor?: string | undefined;
    },
    scope: Scope,
  ) {
    /**
     * The native diff is sliced (`pullRequests.diff` pages file-granular
     * slices). Walk slices until the diff is whole or the delivered-unit
     * budget is hit; a slice that alone exceeds the budget fails the stream
     * rather than delivering a mid-file prefix the manifest could not resume
     * from honestly.
     */
    let patch = "";
    let truncated = false;
    let nextCursor: string | null = null;
    const omitted: Array<{ path: string; additions: number; deletions: number }> = [];
    let cursor = safe.cursor;
    for (;;) {
      const slice = yield* dependencies.pullRequests
        .diff({
          projectId: projectIdOf(scope),
          ...(safe.host === undefined ? {} : { host: safe.host }),
          repository: safe.repository,
          number: safe.number,
          ...(cursor === undefined ? {} : { cursor }),
          ...(safe.commit === undefined ? {} : { commit: safe.commit }),
        })
        .pipe(Effect.mapError(operationError("prs.streamDiff")));
      if (slice.truncated) truncated = true;
      if (slice.omittedFileStats !== undefined) omitted.push(...slice.omittedFileStats);
      if (patch.length > 0 && patch.length + slice.patch.length > MAX_DIFF_STREAM_UNITS) {
        // Stop between whole slices: this slice is undelivered, and the
        // manifest's nextCursor points back at it.
        truncated = true;
        nextCursor = cursor ?? null;
        break;
      }
      if (slice.patch.length > MAX_DIFF_STREAM_UNITS) {
        return yield* failure(
          "prs.streamDiff",
          "A single pull request diff slice exceeds the stream delivery bound.",
        );
      }
      patch += slice.patch;
      if (slice.nextCursor === null) break;
      cursor = slice.nextCursor;
    }
    const chunks = splitStreamChunks(patch);
    return {
      patch,
      chunks,
      manifest: {
        kind: "manifest" as const,
        repository: safe.repository,
        number: safe.number,
        ...(safe.host === undefined ? {} : { host: safe.host }),
        ...(safe.commit === undefined ? {} : { commit: safe.commit }),
        diffHash: sha256(patch),
        diffByteLength: Buffer.byteLength(patch, "utf8"),
        chunkCount: chunks.length,
        truncated,
        nextCursor,
        ...(omitted.length === 0 ? {} : { omittedFileStats: omitted }),
      } satisfies PrsDiffStreamEvent,
    };
  });

  return {
    providerId: "t3.host-prs-read",
    definition: PRS_READ_API,
    requiresRootAuthority: true,
    invoke: invokeProvider({
      getCapabilities: runMethod({
        operation: "prs.getCapabilities",
        decode: emptyInput,
        run: Effect.fn("prs.getCapabilities")(function* (_safe, scope) {
          /**
           * The native listing is the honest probe: it already resolves the
           * scoped project's repository to a host, reports every host's
           * configured state, and fails by name when the only host's tool or
           * credentials are unusable. A project whose repository resolves to
           * no host answers an empty provider list, which is `hosted:false` —
           * the capability honesty the contract promises, rather than an
           * invented host.
           */
          const probe = yield* dependencies.pullRequests
            .list({ state: "open", projectIds: [projectIdOf(scope)], limit: 1 })
            .pipe(
              Effect.map(
                (result) =>
                  ({ providers: result.providers, detail: null }) as {
                    readonly providers: PrsCapabilitiesResult["providers"];
                    readonly detail: string | null;
                  },
              ),
              Effect.catch((cause: PullRequestError) =>
                Effect.succeed({
                  providers: [],
                  detail: cause.message.slice(0, 512),
                }),
              ),
            );
          const apis = probe.providers
            .filter((provider) => provider.configured)
            .map((provider) => dependencies.prRegistry.get(provider.kind))
            .filter((api): api is PullRequestProviderApi => api !== null);
          return {
            hosted: probe.providers.length > 0,
            detail: probe.detail,
            providers: probe.providers,
            operations: operationsSupport(apis),
          } satisfies PrsCapabilitiesResult;
        }),
      }),
      list: runMethod({
        operation: "prs.list",
        decode: listInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .list({ ...safe, projectIds: [projectIdOf(scope)] })
            .pipe(Effect.map(boundList)),
      }),
      listStats: runMethod({
        operation: "prs.listStats",
        decode: listStatsInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .listStats({
              refs: safe.refs.map((ref) => nativeRef(scope, ref)),
            })
            .pipe(Effect.map((result): PrsListStatsResult => result as PrsListStatsResult)),
      }),
      summary: runMethod({
        operation: "prs.summary",
        decode: refInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .summary(nativeRef(scope, safe))
            .pipe(Effect.map((result): PrsSummary => result as PrsSummary)),
      }),
      detail: runMethod({
        operation: "prs.detail",
        decode: refInput,
        run: (safe, scope) =>
          dependencies.pullRequests.detail(nativeRef(scope, safe)).pipe(Effect.map(boundDetail)),
      }),
      activity: runMethod({
        operation: "prs.activity",
        decode: refInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .activity(nativeRef(scope, safe))
            .pipe(Effect.map(boundActivity)),
      }),
      threadComments: runMethod({
        operation: "prs.threadComments",
        decode: threadCommentsInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .threadComments({
              ...nativeRef(scope, safe),
              threadId: safe.threadId,
              cursor: safe.cursor,
            })
            .pipe(
              Effect.map(
                (result): PrsThreadCommentsResult =>
                  boundThreadComments(result) as PrsThreadCommentsResult,
              ),
            ),
      }),
      stack: runMethod({
        operation: "prs.stack",
        decode: refInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .stack(nativeRef(scope, safe))
            .pipe(Effect.map((result): PrsStack | null => result as PrsStack | null)),
      }),
      linkedThreads: runMethod({
        operation: "prs.linkedThreads",
        decode: refInput,
        run: Effect.fn("prs.linkedThreads")(function* (safe, scope) {
          const key = yield* resolveSyncKey(nativeRef(scope, safe));
          if (key === null) return { threads: [] } satisfies PrsLinkedThreadsResult;
          return (yield* listLinkedPullRequestThreads(key).pipe(
            Effect.provideService(SqlClient.SqlClient, dependencies.sql),
            Effect.map(boundLinkedThreads),
          )) as PrsLinkedThreadsResult;
        }),
      }),
      reviewerCandidates: runMethod({
        operation: "prs.reviewerCandidates",
        decode: refInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .reviewerCandidates(nativeRef(scope, safe))
            .pipe(
              Effect.map(
                (result): PrsReviewerCandidateList =>
                  boundCandidates(result, MAX_CANDIDATES) as PrsReviewerCandidateList,
              ),
            ),
      }),
      labelCandidates: runMethod({
        operation: "prs.labelCandidates",
        decode: refInput,
        run: (safe, scope) =>
          dependencies.pullRequests
            .labelCandidates(nativeRef(scope, safe))
            .pipe(
              Effect.map(
                (result): PrsLabelCandidateList =>
                  boundCandidates(result, MAX_LABEL_CANDIDATES) as PrsLabelCandidateList,
              ),
            ),
      }),
      invalidate: runMethod({
        operation: "prs.invalidate",
        decode: invalidateInput,
        run: Effect.fn("prs.invalidate")(function* (safe, scope) {
          yield* dependencies.pullRequests.invalidate(
            safe.reference === undefined ? {} : { reference: nativeRef(scope, safe.reference) },
          );
          return {};
        }),
      }),
    }),
    subscribe: (name, input, context, signal, metadata, resumeCursor) => {
      if (
        name !== "streamDiff" &&
        name !== "streamDiffFileContents" &&
        name !== "subscribeRefreshes"
      )
        throw failure(`prs.${name}`, "Pull request stream is unavailable.");
      if (resumeCursor !== undefined)
        throw failure(`prs.${name}`, "Pull request stream resume is unsupported.");
      const safe = (() => {
        try {
          return name === "streamDiff"
            ? ({ kind: "diff", input: diffInput(input) } as const)
            : name === "streamDiffFileContents"
              ? ({ kind: "fileContents", input: diffFileContentsInput(input) } as const)
              : ({ kind: "refreshes", input: emptyInput(input) } as const);
        } catch {
          throw failure(`prs.${name}`, "Invalid pull request stream request.");
        }
      })();
      if (!authorized(metadata.principal))
        throw failure(`prs.${name}`, "Pull request authority is unavailable.");
      const assertAuthority = () => metadata.assertAuthority?.() ?? Promise.resolve();
      if (safe.kind === "refreshes") {
        /**
         * The native refresh counter as data frames — one `{kind:"refreshed"}`
         * per invalidation, so a plugin re-reads exactly when the native
         * client would. Same queue discipline as the vcs status stream:
         * bursts past the queue close the stream with a named reason rather
         * than growing unboundedly behind a slow consumer.
         */
        const maxQueuedEvents = 64;
        const queue: ApiStreamEvent[] = [];
        let finished = false;
        let aborted = signal.aborted;
        let wake: (() => void) | null = null;
        let cleanup: (() => void) | null = null;
        let setup: Promise<void> | null = null;
        let setupFailure: unknown = null;
        const controller = new AbortController();
        const runSignal = AbortSignal.any([signal, controller.signal]);
        let removeAbortListener: (() => void) | null = null;

        const finish = () => {
          finished = true;
          cleanup?.();
          cleanup = null;
          removeAbortListener?.();
          removeAbortListener = null;
          wake?.();
          wake = null;
        };
        const pushClosed = (reason: "overflow" | "refresh-error") => {
          queue.length = 0;
          queue.push({
            type: "closed",
            value: { kind: "closed", reason } satisfies PrsRefreshedEvent,
          });
          finish();
        };
        const push = (event: ApiStreamEvent) => {
          if (finished || aborted) return;
          if (queue.length >= maxQueuedEvents) {
            pushClosed("overflow");
          } else {
            queue.push(event);
          }
          wake?.();
          wake = null;
        };
        const abort = () => {
          aborted = true;
          controller.abort();
          queue.length = 0;
          finish();
          wake?.();
          wake = null;
        };
        signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", abort);

        const iterable: AsyncIterable<ApiStreamEvent> = {
          [Symbol.asyncIterator]() {
            let returned = false;
            // Only an external cancel poisons the iterator; an internal
            // controller.abort() on stream completion must still let queued
            // events drain before `done`.
            const failIfAborted = () => {
              if (aborted)
                throw runSignal.reason ?? failure("prs.subscribeRefreshes", "Stream cancelled.");
            };
            const finishIterator = async () => {
              controller.abort();
              finish();
            };
            return {
              async next() {
                if (returned) return { done: true, value: undefined };
                failIfAborted();
                setup ??= (async () => {
                  try {
                    await Effect.runPromise(resolve(context), { signal: runSignal });
                    await assertAuthority();
                    cleanup = () => controller.abort();
                    Effect.runPromise(
                      Stream.runForEach(dependencies.pullRequests.subscribeRefreshes, (revision) =>
                        Effect.sync(() =>
                          push({
                            type: "data",
                            value: { kind: "refreshed", revision } satisfies PrsRefreshedEvent,
                          }),
                        ),
                      ),
                      { signal: runSignal },
                    ).then(
                      () => finish(),
                      () => pushClosed("refresh-error"),
                    );
                  } catch (error) {
                    setupFailure = error;
                    finish();
                    throw error;
                  }
                })();
                try {
                  await setup;
                  if (setupFailure !== null) throw setupFailure;
                  failIfAborted();
                  // The native stream callback may finish this observer while next() waits.
                  // eslint-disable-next-line no-unmodified-loop-condition
                  while (queue.length === 0 && !finished) {
                    await new Promise<void>((resolveWait) => {
                      wake = resolveWait;
                    });
                    failIfAborted();
                  }
                  failIfAborted();
                  const value = queue.shift();
                  if (!value) {
                    await finishIterator();
                    returned = true;
                    return { done: true, value: undefined };
                  }
                  return { done: false, value };
                } catch (error) {
                  await finishIterator();
                  returned = true;
                  throw error;
                }
              },
              async return() {
                returned = true;
                abort();
                await finishIterator();
                return { done: true, value: undefined };
              },
            };
          },
        };
        return iterable;
      }
      return (async function* (): AsyncGenerator<ApiStreamEvent> {
        const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { signal });
        signal.throwIfAborted();
        const scope = await run(resolve(context));
        // The unary discipline stretched over a finite transfer: re-resolve
        // the scope and re-assert authority at each frame boundary so a
        // revoked principal or moved workspace stops the stream mid-flight.
        const guard = async () => {
          signal.throwIfAborted();
          await run(resolve(scope.context));
          await assertAuthority();
        };
        if (safe.kind === "diff") {
          const { chunks, manifest } = await run(
            streamDiff(safe.input, scope).pipe(Effect.mapError(operationError("prs.streamDiff"))),
          );
          assertStreamFrameFits("prs.streamDiff", manifest);
          yield { type: "snapshot", value: manifest };
          const payloadHash = NodeCrypto.createHash("sha256");
          for (const [chunkIndex, data] of chunks.entries()) {
            await guard();
            payloadHash.update(data, "utf8");
            const chunk: PrsDiffStreamEvent = { kind: "chunk", chunkIndex, data };
            assertStreamFrameFits("prs.streamDiff", chunk);
            yield { type: "data", value: chunk };
          }
          const complete: PrsDiffStreamEvent = {
            kind: "complete",
            payloadSha256: payloadHash.digest("hex"),
          };
          await guard();
          yield { type: "data", value: complete };
          return;
        }
        const contents = await run(
          dependencies.pullRequests
            .diffFileContents({
              projectId: projectIdOf(scope),
              ...(safe.input.host === undefined ? {} : { host: safe.input.host }),
              repository: safe.input.repository,
              number: safe.input.number,
              ...(safe.input.commit === undefined ? {} : { commit: safe.input.commit }),
              changeType: safe.input.changeType,
              oldPath: safe.input.oldPath,
              newPath: safe.input.newPath,
            })
            .pipe(Effect.mapError(operationError("prs.streamDiffFileContents"))),
        );
        if (
          contents.oldContents.length > MAX_FILE_CONTENTS_CHARS ||
          contents.newContents.length > MAX_FILE_CONTENTS_CHARS
        ) {
          throw failure(
            "prs.streamDiffFileContents",
            "Pull request diff file contents exceed the public bounds.",
          );
        }
        const sides = [
          { side: "old" as const, contents: contents.oldContents },
          { side: "new" as const, contents: contents.newContents },
        ].map((entry) => ({ ...entry, chunks: splitStreamChunks(entry.contents) }));
        const manifest = {
          kind: "manifest" as const,
          oldByteLength: Buffer.byteLength(contents.oldContents, "utf8"),
          oldChunkCount: sides[0]!.chunks.length,
          newByteLength: Buffer.byteLength(contents.newContents, "utf8"),
          newChunkCount: sides[1]!.chunks.length,
        } satisfies VcsDiffFileContentsStreamEvent;
        assertStreamFrameFits("prs.streamDiffFileContents", manifest);
        yield { type: "snapshot", value: manifest };
        for (const { side, chunks } of sides) {
          for (const [chunkIndex, data] of chunks.entries()) {
            await guard();
            const chunk = { kind: "chunk" as const, side, chunkIndex, data };
            assertStreamFrameFits("prs.streamDiffFileContents", chunk);
            yield { type: "data", value: chunk };
          }
        }
        await guard();
        yield {
          type: "data",
          value: {
            kind: "complete",
            oldSha256: sha256(sides[0]!.contents),
            newSha256: sha256(sides[1]!.contents),
          } satisfies VcsDiffFileContentsStreamEvent,
        };
      })();
    },
  };
}

export const makePrsApiProvider = Effect.fn("PrsApi.make")(function* () {
  const environment = yield* ServerEnvironment;
  return createPrsApiProvider({
    environmentId: yield* environment.getEnvironmentId,
    projects: yield* ProjectionProjectRepository,
    threads: yield* ProjectionThreadRepository,
    pullRequests: yield* PullRequestService,
    prRegistry: yield* PullRequestProviderRegistry,
    projectionSnapshotQuery: yield* ProjectionSnapshotQuery,
    sql: yield* SqlClient.SqlClient,
  });
});
