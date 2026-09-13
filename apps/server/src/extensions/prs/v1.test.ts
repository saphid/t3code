import {
  AuthOrchestrationReadScope,
  ExtensionOperationError,
  ProjectId,
  PullRequestUnavailableError,
  extensionWorkspaceRevision,
  type OrchestrationProjectShell,
  type PullRequestActivity as NativePullRequestActivity,
  type PullRequestDetail as NativePullRequestDetail,
  type PullRequestDiffResult as NativePullRequestDiffResult,
  type PullRequestListResult as NativePullRequestListResult,
  type PullRequestRef as NativePullRequestRef,
} from "@t3tools/contracts";
import type { PrsDiffStreamEvent } from "@t3tools/extension-sdk/catalogue";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "node:crypto";
import { it, expect } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { HostApiProvider } from "@t3tools/extension-runtime";
import type { ApiStreamEvent } from "@t3tools/extension-sdk/capabilities";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { PullRequestProviderApi } from "../../pullRequest/PullRequestProvider.ts";
import { fromProviders } from "../../pullRequest/PullRequestProviderRegistry.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { createPrsApiProvider } from "./v1.ts";

const isOperationError = Schema.is(ExtensionOperationError);
const READ_ONLY = [AuthOrchestrationReadScope] as const;
const signal = new AbortController().signal;

const PROJECT_ID = ProjectId.make("project");
const WORKSPACE_ROOT = "/workspace/project";
const NOW = "2026-01-01T00:00:00.000Z";

class InvokeRejection extends Data.TaggedError("InvokeRejection")<{
  readonly cause: unknown;
}> {}

const makeContext = (): ViewContext => ({
  resource: {
    namespace: "test.extension",
    id: "surface",
    environmentId: "env",
    projectId: "project",
    threadId: "thread",
  },
  client: "test",
  workspaceRevision: extensionWorkspaceRevision(WORKSPACE_ROOT, null),
});

const meta = (
  provider: HostApiProvider,
  scopes: readonly string[] = READ_ONLY,
): Parameters<HostApiProvider["invoke"]>[4] => ({
  callId: "call",
  rootCallerId: "root",
  callerId: "caller",
  providerId: provider.providerId,
  providerGeneration: 1,
  callerGenerations: [],
  principal: {
    kind: "environment-session",
    id: "session",
    environmentId: "env",
    scopes,
  },
  assertAuthority: async () => {},
});

const invoke = (
  provider: HostApiProvider,
  method: string,
  input: Parameters<HostApiProvider["invoke"]>[1],
  context: ViewContext,
  scopes: readonly string[] = READ_ONLY,
) =>
  Effect.tryPromise({
    try: () =>
      Promise.resolve(provider.invoke(method, input, context, signal, meta(provider, scopes))),
    catch: (cause) => new InvokeRejection({ cause }),
  });

const invokeError = (...args: Parameters<typeof invoke>) =>
  invoke(...args).pipe(
    Effect.flip,
    Effect.map((rejection) => {
      if (!isOperationError(rejection.cause)) {
        throw new Error(`expected ExtensionOperationError, got ${String(rejection.cause)}`);
      }
      return rejection.cause;
    }),
  );

const collectStream = (
  provider: HostApiProvider,
  name: string,
  input: unknown,
  context: ViewContext,
  scopes: readonly string[] = READ_ONLY,
  resumeCursor?: string,
) =>
  Effect.tryPromise({
    try: async () => {
      const iterable = provider.subscribe!(
        name,
        input as Parameters<NonNullable<HostApiProvider["subscribe"]>>[1],
        context,
        signal,
        meta(provider, scopes),
        resumeCursor,
      );
      const events: ApiStreamEvent[] = [];
      for await (const event of iterable) events.push(event);
      return events;
    },
    catch: (cause) => new InvokeRejection({ cause }),
  });

const collectStreamError = (...args: Parameters<typeof collectStream>) =>
  collectStream(...args).pipe(
    Effect.flip,
    Effect.map((rejection) => {
      if (!isOperationError(rejection.cause)) {
        throw new Error(`expected ExtensionOperationError, got ${String(rejection.cause)}`);
      }
      return rejection.cause;
    }),
  );

const REF = { repository: "owner/repo", number: 42 } as const;

const listEntry = {
  provider: "github" as const,
  host: "github.com",
  projectId: PROJECT_ID,
  projectTitle: "Project",
  repository: "owner/repo",
  number: 42,
  title: "Ship it",
  url: "https://github.com/owner/repo/pull/42",
  author: { login: "octocat", name: null, avatarUrl: null },
  headBranch: "feature",
  baseBranch: "main",
  state: "open" as const,
  isDraft: false,
  mergeability: "mergeable" as const,
  additions: 3,
  deletions: 1,
  createdAt: NOW,
  updatedAt: NOW,
  viewerReviewRequested: false,
  labels: [],
};

const listResult = {
  viewers: { "github.com": "octocat" },
  providers: [
    {
      host: "github.com",
      kind: "github" as const,
      searchesOnHost: true,
      projectCount: 1,
      configured: true,
      detail: null,
    },
  ],
  entries: [listEntry],
  errors: [],
  truncated: false,
  nextCursors: {},
} satisfies NativePullRequestListResult;

const detail = {
  provider: "github" as const,
  capabilities: {
    diff: true,
    comment: true,
    actions: ["merge" as const],
    mergeMethods: ["merge" as const],
    search: true,
    review: { inlineComment: true, reply: true, resolve: true, verdicts: ["approve" as const] },
    reviewers: { request: true, listCandidates: true },
  },
  viewerPermissions: {
    actions: ["merge" as const],
    comment: true,
    resolve: true,
    verdicts: ["approve" as const],
    requestReviewers: true,
  },
  projectId: PROJECT_ID,
  projectTitle: "Project",
  workspaceRoot: WORKSPACE_ROOT,
  repository: "owner/repo",
  number: 42,
  title: "Ship it",
  body: "the body",
  url: "https://github.com/owner/repo/pull/42",
  author: { login: "octocat", name: null, avatarUrl: null },
  state: "open" as const,
  isDraft: false,
  mergeability: "mergeable" as const,
  additions: 3,
  deletions: 1,
  changedFiles: 2,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: NOW,
  updatedAt: NOW,
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  mergeCapabilities: { merge: true, squash: false, rebase: false },
} satisfies NativePullRequestDetail;

const activity: NativePullRequestActivity = {
  comments: [
    {
      id: "c1",
      kind: "issue-comment" as const,
      author: { login: "octocat", name: null, avatarUrl: null },
      body: "looks good",
      createdAt: NOW,
      url: null,
      path: null,
      reviewState: null,
    },
  ],
  commentCount: 1,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [
    {
      oid: "abc123",
      messageHeadline: "ship it",
      committedDate: NOW,
    },
  ],
};

type Deps = Parameters<typeof createPrsApiProvider>[0];

const githubProviderApi = (
  overrides: Partial<PullRequestProviderApi["capabilities"]> = {},
  extras: {
    [K in keyof PullRequestProviderApi]?: PullRequestProviderApi[K] | undefined;
  } = {},
): PullRequestProviderApi =>
  ({
    kind: "github",
    capabilities: {
      diff: true,
      comment: true,
      actions: [],
      mergeMethods: ["merge"],
      search: true,
      review: { inlineComment: true, reply: true, resolve: true, verdicts: ["approve"] },
      reviewers: { request: true, listCandidates: true },
      labels: true,
      ...overrides,
    },
    getReviewThreadComments: () => Effect.die("unused"),
    getChangeRequestStack: () => Effect.die("unused"),
    getDiffFileContents: () => Effect.die("unused"),
    ...extras,
  }) as PullRequestProviderApi;

const projectShell = (
  repositoryIdentity: OrchestrationProjectShell["repositoryIdentity"] = null,
): OrchestrationProjectShell =>
  ({
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot: WORKSPACE_ROOT,
    repositoryIdentity,
    defaultModelSelection: null,
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
  }) as OrchestrationProjectShell;

const makeDeps = (
  pullRequests: Partial<Deps["pullRequests"]>,
  options: {
    readonly registry?: Deps["prRegistry"];
    readonly shell?: OrchestrationProjectShell;
    readonly sql?: SqlClient.SqlClient;
  } = {},
): Deps => ({
  environmentId: "env",
  projects: {
    getById: () =>
      Effect.succeed(
        Option.some({
          projectId: PROJECT_ID,
          workspaceRoot: WORKSPACE_ROOT,
          deletedAt: null,
        }),
      ),
  },
  threads: {
    getById: () =>
      Effect.succeed(Option.some({ projectId: PROJECT_ID, worktreePath: null, deletedAt: null })),
  },
  pullRequests: {
    list: () => Effect.die("unused"),
    listStats: () => Effect.die("unused"),
    summary: () => Effect.die("unused"),
    stack: () => Effect.die("unused"),
    detail: () => Effect.die("unused"),
    activity: () => Effect.die("unused"),
    threadComments: () => Effect.die("unused"),
    diff: () => Effect.die("unused"),
    diffFileContents: () => Effect.die("unused"),
    reviewerCandidates: () => Effect.die("unused"),
    labelCandidates: () => Effect.die("unused"),
    invalidate: () => Effect.die("unused"),
    subscribeRefreshes: Stream.never,
    ...pullRequests,
  },
  prRegistry: options.registry ?? fromProviders([]),
  projectionSnapshotQuery: {
    getProjectShellById: () => Effect.succeed(Option.some(options.shell ?? projectShell())),
  },
  sql: options.sql ?? ({} as SqlClient.SqlClient),
});

it.layer(NodeServices.layer)("t3.prs/read adapter", (it) => {
  it.effect("list forces the scoped project and round-trips rows", () =>
    Effect.gen(function* () {
      const calls: { method: string; input: unknown }[] = [];
      const provider = createPrsApiProvider(
        makeDeps({
          list: (input) => {
            calls.push({ method: "list", input });
            return Effect.succeed(listResult);
          },
        }),
      );
      const result = (yield* invoke(provider, "list", { state: "open" }, makeContext())) as {
        entries: readonly { number: number }[];
        nextCursors: Record<string, string>;
      };
      // projectIds is not part of the public input; the scope's project is
      // always the one queried.
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toMatchObject({
        state: "open",
        projectIds: ["project"],
      });
      expect(result.entries[0]!.number).toBe(42);
      expect(result.nextCursors).toEqual({});

      // A smuggled projectIds cannot widen the scope: the strict decoder
      // refuses it by operation name.
      const widened = yield* invokeError(
        provider,
        "list",
        { state: "open", projectIds: ["other"] },
        makeContext(),
      );
      expect(widened.operation).toBe("prs.list");
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect("detail and activity round-trip the native shapes", () =>
    Effect.gen(function* () {
      const calls: { method: string; input: unknown }[] = [];
      const provider = createPrsApiProvider(
        makeDeps({
          detail: (input) => {
            calls.push({ method: "detail", input });
            return Effect.succeed(detail);
          },
          activity: (input) => {
            calls.push({ method: "activity", input });
            return Effect.succeed(activity);
          },
        }),
      );
      const context = makeContext();
      const got = (yield* invoke(provider, "detail", REF, context)) as { title: string };
      expect(got.title).toBe("Ship it");
      const nativeRef = calls[0]!.input as NativePullRequestRef;
      expect(nativeRef).toEqual({ projectId: PROJECT_ID, repository: "owner/repo", number: 42 });

      const gotActivity = (yield* invoke(provider, "activity", REF, context)) as {
        comments: readonly { body: string }[];
        truncated: boolean;
      };
      expect(gotActivity.comments[0]!.body).toBe("looks good");
      expect(gotActivity.truncated).toBe(false);
    }),
  );

  it.effect("denies each operation by name without the read scope", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(makeDeps({}));
      const context = makeContext();
      for (const [method, input] of [
        ["list", { state: "open" }],
        ["detail", REF],
        ["activity", REF],
        ["getCapabilities", {}],
      ] as const) {
        const error = yield* invokeError(provider, method, input, context, []);
        expect(error.operation).toBe(`prs.${method}`);
      }
    }),
  );

  it.effect("denies a principal from another environment", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(makeDeps({}));
      const context = makeContext();
      const wrongEnvironment = {
        ...meta(provider),
        principal: {
          kind: "environment-session" as const,
          id: "session",
          environmentId: "other-env",
          scopes: [AuthOrchestrationReadScope],
        },
      };
      const error = yield* Effect.tryPromise({
        try: () =>
          Promise.resolve(
            provider.invoke("list", { state: "open" }, context, signal, wrongEnvironment),
          ),
        catch: (cause) => new InvokeRejection({ cause }),
      }).pipe(
        Effect.flip,
        Effect.map((rejection) => {
          if (!isOperationError(rejection.cause)) {
            throw new Error(`expected ExtensionOperationError, got ${String(rejection.cause)}`);
          }
          return rejection.cause;
        }),
      );
      expect(error.operation).toBe("prs.list");
    }),
  );

  it.effect("rejects invalid input by operation name", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(makeDeps({}));
      const error = yield* invokeError(provider, "list", { state: "bogus" }, makeContext());
      expect(error.operation).toBe("prs.list");
    }),
  );

  it.effect("getCapabilities reports a hostless project honestly", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(
        makeDeps({
          list: () => Effect.succeed({ ...listResult, providers: [], entries: [] }),
        }),
      );
      const capabilities = (yield* invoke(provider, "getCapabilities", {}, makeContext())) as {
        hosted: boolean;
        detail: string | null;
        providers: readonly unknown[];
        operations: Record<string, boolean>;
      };
      expect(capabilities.hosted).toBe(false);
      expect(capabilities.providers).toEqual([]);
      expect(capabilities.operations["prs.list"]).toBe(false);
      expect(capabilities.operations["prs.detail"]).toBe(false);
      expect(capabilities.operations["prs.streamDiff"]).toBe(false);
      // Environment-local operations do not need a host.
      expect(capabilities.operations["prs.linkedThreads"]).toBe(true);
      expect(capabilities.operations["prs.invalidate"]).toBe(true);
      expect(capabilities.operations["prs.subscribeRefreshes"]).toBe(true);
    }),
  );

  it.effect("getCapabilities names the probe failure when the host is unreachable", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(
        makeDeps({
          list: () =>
            Effect.fail(
              new PullRequestUnavailableError({ reason: "cli-missing", provider: "github" }),
            ),
        }),
      );
      const capabilities = (yield* invoke(provider, "getCapabilities", {}, makeContext())) as {
        hosted: boolean;
        detail: string | null;
        operations: Record<string, boolean>;
      };
      expect(capabilities.hosted).toBe(false);
      expect(capabilities.detail).toContain("GitHub CLI");
      expect(capabilities.operations["prs.list"]).toBe(false);
    }),
  );

  it.effect("getCapabilities derives operation support from the configured provider api", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(
        makeDeps(
          { list: () => Effect.succeed(listResult) },
          { registry: fromProviders([githubProviderApi()]) },
        ),
      );
      const capabilities = (yield* invoke(provider, "getCapabilities", {}, makeContext())) as {
        hosted: boolean;
        operations: Record<string, boolean>;
      };
      expect(capabilities.hosted).toBe(true);
      expect(capabilities.operations["prs.list"]).toBe(true);
      expect(capabilities.operations["prs.detail"]).toBe(true);
      expect(capabilities.operations["prs.threadComments"]).toBe(true);
      expect(capabilities.operations["prs.stack"]).toBe(true);
      expect(capabilities.operations["prs.reviewerCandidates"]).toBe(true);
      expect(capabilities.operations["prs.labelCandidates"]).toBe(true);
      expect(capabilities.operations["prs.streamDiff"]).toBe(true);
      expect(capabilities.operations["prs.streamDiffFileContents"]).toBe(true);
    }),
  );

  it.effect("a provider without optional methods reports those operations unsupported", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(
        makeDeps(
          { list: () => Effect.succeed(listResult) },
          {
            registry: fromProviders([
              githubProviderApi(
                { diff: false, reviewers: { request: true, listCandidates: false } },
                {
                  getReviewThreadComments: undefined,
                  getChangeRequestStack: undefined,
                  getDiffFileContents: undefined,
                },
              ),
            ]),
          },
        ),
      );
      const capabilities = (yield* invoke(provider, "getCapabilities", {}, makeContext())) as {
        operations: Record<string, boolean>;
      };
      expect(capabilities.operations["prs.list"]).toBe(true);
      expect(capabilities.operations["prs.threadComments"]).toBe(false);
      expect(capabilities.operations["prs.stack"]).toBe(false);
      expect(capabilities.operations["prs.reviewerCandidates"]).toBe(false);
      expect(capabilities.operations["prs.streamDiff"]).toBe(false);
      expect(capabilities.operations["prs.streamDiffFileContents"]).toBe(false);
    }),
  );

  it.effect("detail caps an oversized body and flags it", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(
        makeDeps({
          detail: () => Effect.succeed({ ...detail, body: "x".repeat(32 * 1024) }),
        }),
      );
      const got = (yield* invoke(provider, "detail", REF, makeContext())) as {
        body: string;
        bodyTruncated?: boolean;
      };
      expect(got.bodyTruncated).toBe(true);
      expect(got.body.length).toBe(16_384);
    }),
  );

  it.effect("activity truncates a long conversation with honest flags", () =>
    Effect.gen(function* () {
      const many = {
        ...activity,
        comments: Array.from({ length: 150 }, (_, index) => ({
          id: `c${index}`,
          kind: "issue-comment" as const,
          author: null,
          body: `comment ${index}`,
          createdAt: NOW,
          url: null,
          path: null,
          reviewState: null,
        })),
        commentCount: 150,
      } satisfies NativePullRequestActivity;
      const provider = createPrsApiProvider(makeDeps({ activity: () => Effect.succeed(many) }));
      const got = (yield* invoke(provider, "activity", REF, makeContext())) as {
        comments: readonly unknown[];
        commentsTruncated: boolean;
        truncated: boolean;
      };
      expect(got.comments).toHaveLength(100);
      expect(got.commentsTruncated).toBe(true);
      expect(got.truncated).toBe(true);
    }),
  );

  it.effect("threadComments, stack, candidates, and invalidate round-trip", () =>
    Effect.gen(function* () {
      const calls: { method: string; input: unknown }[] = [];
      const provider = createPrsApiProvider(
        makeDeps({
          threadComments: (input) => {
            calls.push({ method: "threadComments", input });
            return Effect.succeed({
              comments: [
                {
                  id: "t1",
                  author: null,
                  body: "thread reply",
                  createdAt: NOW,
                  url: null,
                },
              ],
              nextCursor: null,
            });
          },
          stack: () => Effect.succeed(null),
          reviewerCandidates: () =>
            Effect.succeed({
              candidates: [
                {
                  login: "hubot",
                  name: null,
                  avatarUrl: null,
                  id: "hubot",
                  kind: "user" as const,
                  isRequested: false,
                },
              ],
              truncated: false,
            }),
          labelCandidates: () =>
            Effect.succeed({
              candidates: [{ name: "bug", color: "ff0000", description: null, isApplied: false }],
              truncated: false,
            }),
          invalidate: (input) => {
            calls.push({ method: "invalidate", input });
            return Effect.void;
          },
        }),
      );
      const context = makeContext();
      const comments = (yield* invoke(
        provider,
        "threadComments",
        { ...REF, threadId: "thread-1", cursor: "c0" },
        context,
      )) as { comments: readonly { body: string }[] };
      expect(comments.comments[0]!.body).toBe("thread reply");
      expect(calls[0]!.input).toMatchObject({
        projectId: PROJECT_ID,
        threadId: "thread-1",
        cursor: "c0",
      });

      expect(yield* invoke(provider, "stack", REF, context)).toBeNull();
      const reviewers = (yield* invoke(provider, "reviewerCandidates", REF, context)) as {
        candidates: readonly { login: string }[];
      };
      expect(reviewers.candidates[0]!.login).toBe("hubot");
      const labels = (yield* invoke(provider, "labelCandidates", REF, context)) as {
        candidates: readonly { name: string }[];
      };
      expect(labels.candidates[0]!.name).toBe("bug");

      yield* invoke(provider, "invalidate", {}, context);
      const invalidated = calls.find((call) => call.method === "invalidate");
      expect(invalidated!.input).toEqual({});
    }),
  );

  it.effect("streamDiff frames whole slices and verifies the delivered sha256", () =>
    Effect.gen(function* () {
      const first = "diff --git a/a.txt b/a.txt\n+one\n";
      const second = "diff --git a/b.txt b/b.txt\n+two\n";
      const slices: Record<string, NativePullRequestDiffResult> = {
        start: { patch: first, truncated: false, nextCursor: "c1" },
        c1: { patch: second, truncated: false, nextCursor: null },
      };
      const diffCalls: unknown[] = [];
      const provider = createPrsApiProvider(
        makeDeps({
          diff: (input) => {
            diffCalls.push(input);
            const slice = slices[input.cursor ?? "start"];
            return slice === undefined
              ? Effect.die(`unexpected cursor ${String(input.cursor)}`)
              : Effect.succeed(slice);
          },
        }),
      );
      const events = yield* collectStream(provider, "streamDiff", REF, makeContext());
      expect(diffCalls).toHaveLength(2);

      const manifest = events[0]!;
      expect(manifest.type).toBe("snapshot");
      const manifestValue = manifest.value as Extract<PrsDiffStreamEvent, { kind: "manifest" }>;
      expect(manifestValue.kind).toBe("manifest");
      expect(manifestValue.chunkCount).toBe(1);
      expect(manifestValue.truncated).toBe(false);
      expect(manifestValue.nextCursor).toBeNull();
      expect(manifestValue.diffHash).toBe(
        NodeCrypto.createHash("sha256")
          .update(first + second, "utf8")
          .digest("hex"),
      );

      const chunk = events[1]!.value as Extract<PrsDiffStreamEvent, { kind: "chunk" }>;
      expect(chunk.data).toBe(first + second);
      const complete = events[2]!.value as Extract<PrsDiffStreamEvent, { kind: "complete" }>;
      expect(complete.payloadSha256).toBe(manifestValue.diffHash);
      expect(events).toHaveLength(3);
    }),
  );

  it.effect("streamDiffFileContents frames both sides with verifiable hashes", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(
        makeDeps({
          diffFileContents: () =>
            Effect.succeed({ oldContents: "before\n", newContents: "after\n" }),
        }),
      );
      const events = yield* collectStream(
        provider,
        "streamDiffFileContents",
        { ...REF, changeType: "change", oldPath: "a.txt", newPath: "a.txt" },
        makeContext(),
      );
      const manifest = events[0]!.value as {
        kind: string;
        oldChunkCount: number;
        newChunkCount: number;
      };
      expect(manifest.kind).toBe("manifest");
      const chunks = events
        .slice(1, -1)
        .map((event) => event.value as { kind: string; side: string; data: string });
      expect(chunks.map((chunk) => chunk.side)).toEqual(["old", "new"]);
      expect(chunks.map((chunk) => chunk.data)).toEqual(["before\n", "after\n"]);
      const complete = events.at(-1)!.value as {
        kind: string;
        oldSha256: string;
        newSha256: string;
      };
      expect(complete.oldSha256).toBe(
        NodeCrypto.createHash("sha256").update("before\n", "utf8").digest("hex"),
      );
      expect(complete.newSha256).toBe(
        NodeCrypto.createHash("sha256").update("after\n", "utf8").digest("hex"),
      );
    }),
  );

  it.effect("denies streams by name without the read scope", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(makeDeps({}));
      const error = yield* collectStreamError(provider, "streamDiff", REF, makeContext(), []);
      expect(error.operation).toBe("prs.streamDiff");
      const resumed = yield* collectStreamError(
        provider,
        "streamDiff",
        REF,
        makeContext(),
        READ_ONLY,
        "cursor",
      );
      expect(resumed.operation).toBe("prs.streamDiff");
      const unknown = yield* collectStreamError(provider, "nope", {}, makeContext());
      expect(unknown.operation).toBe("prs.nope");
    }),
  );

  it.effect("subscribeRefreshes forwards native invalidations as refreshed events", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(makeDeps({ subscribeRefreshes: Stream.make(4, 5, 6) }));
      const events = yield* collectStream(provider, "subscribeRefreshes", {}, makeContext());
      expect(events.map((event) => event.value as { kind: string; revision: number })).toEqual([
        { kind: "refreshed", revision: 4 },
        { kind: "refreshed", revision: 5 },
        { kind: "refreshed", revision: 6 },
      ]);
    }),
  );

  it.effect("subscribeRefreshes closes with a named reason when the native stream fails", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(
        makeDeps({
          // The service member is infallible (`SubscriptionRef.changes`); a
          // failing stream exercises the adapter's defensive closed-frame.
          subscribeRefreshes: Stream.fail(new Error("boom")).pipe(Stream.orDie),
        }),
      );
      const events = yield* collectStream(provider, "subscribeRefreshes", {}, makeContext());
      expect(events).toHaveLength(1);
      expect(events[0]!.value).toEqual({ kind: "closed", reason: "refresh-error" });
    }),
  );

  it.effect("linkedThreads answers seeded links and empty when no host key resolves", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, created_at, updated_at, deleted_at
        ) VALUES (
          'thread-1', 'project', 'Linked thread', '{"instanceId":"codex","model":"gpt-5.4"}',
          ${NOW}, ${NOW}, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_pull_requests (
          thread_id, host, repository, number, url, source, linked_at
        ) VALUES (
          'thread-1', 'github.com', 'owner/repo', 42,
          'https://github.com/owner/repo/pull/42', 'linked', ${NOW}
        )
      `;
      const provider = createPrsApiProvider(makeDeps({}, { sql }));
      const context = makeContext();
      const linked = (yield* invoke(
        provider,
        "linkedThreads",
        { host: "GitHub.com", repository: "Owner/Repo", number: 42 },
        context,
      )) as { threads: readonly { id: string; title: string }[] };
      expect(linked.threads).toHaveLength(1);
      expect(linked.threads[0]!.id).toBe("thread-1");

      // No host on the ref and no repository identity on the project shell:
      // no host-level key exists, so the answer is empty rather than an error.
      const hostless = createPrsApiProvider(makeDeps({}, { sql }));
      const unhosted = (yield* invoke(
        hostless,
        "linkedThreads",
        { repository: "owner/repo", number: 42 },
        context,
      )) as { threads: readonly unknown[] };
      expect(unhosted.threads).toEqual([]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("re-checks authority after the native read", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(makeDeps({ list: () => Effect.succeed(listResult) }));
      let asserted = 0;
      const metadata = {
        ...meta(provider),
        assertAuthority: async () => {
          asserted += 1;
        },
      };
      yield* Effect.promise(() =>
        Promise.resolve(
          provider.invoke("list", { state: "open" }, makeContext(), signal, metadata),
        ),
      );
      expect(asserted).toBeGreaterThan(0);
    }),
  );

  it.effect("revoked authority fails the operation by name", () =>
    Effect.gen(function* () {
      const provider = createPrsApiProvider(makeDeps({ list: () => Effect.succeed(listResult) }));
      const metadata = {
        ...meta(provider),
        assertAuthority: () => Promise.reject(new Error("revoked")),
      };
      const error = yield* Effect.tryPromise({
        try: () =>
          Promise.resolve(
            provider.invoke("list", { state: "open" }, makeContext(), signal, metadata),
          ),
        catch: (cause) => new InvokeRejection({ cause }),
      }).pipe(Effect.flip);
      expect(isOperationError(error.cause)).toBe(true);
      if (isOperationError(error.cause)) {
        expect(error.cause.operation).toBe("prs.list");
      }
    }),
  );
});
