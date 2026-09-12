import {
  AssetWorkspacePathValidationError,
  AuthOrchestrationReadScope,
  ExtensionOperationError,
  ProjectId,
  ThreadId,
  extensionWorkspaceRevision,
} from "@t3tools/contracts";
import { WORKSPACE_RESOURCES } from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiProvider } from "@t3tools/extension-runtime";
import { it, expect, describe } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { createResourcesLeaseApiProvider } from "./resourcesLeaseApi.ts";

const isOperationError = Schema.is(ExtensionOperationError);
const signal = new AbortController().signal;
const WORKSPACE = "/repo/workspace";

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
  workspaceRevision: extensionWorkspaceRevision(WORKSPACE, null),
});

const meta = (
  provider: HostApiProvider,
  callerGenerations: readonly {
    pluginId: string;
    contentHash: string;
    installationGeneration: number;
  }[] = [],
  assertAuthority: () => Promise<void> = async () => {},
): Parameters<HostApiProvider["invoke"]>[4] => ({
  callId: "call",
  rootCallerId: "root",
  callerId: "caller",
  providerId: provider.providerId,
  providerGeneration: 1,
  callerGenerations,
  principal: {
    kind: "environment-session",
    id: "session",
    environmentId: "env",
    scopes: [AuthOrchestrationReadScope],
  },
  assertAuthority,
});

type Deps = Parameters<typeof createResourcesLeaseApiProvider>[0];

const fakeUrl = (kind: string, name = "preview.svg") =>
  `/api/assets/${Buffer.from(JSON.stringify({ version: 1, kind, expiresAt: 999 })).toString(
    "base64url",
  )}.sig/${name}`;

const makeDeps = (overrides: Partial<Deps> = {}): Deps => ({
  environmentId: "env",
  projects: {
    getById: () =>
      Effect.succeed(
        Option.some({
          projectId: ProjectId.make("project"),
          workspaceRoot: WORKSPACE,
          faviconPath: null,
          deletedAt: null,
        }),
      ),
  },
  threads: {
    getById: () =>
      Effect.succeed(
        Option.some({
          projectId: ProjectId.make("project"),
          worktreePath: null,
          deletedAt: null,
        }),
      ),
  },
  normalizeWorkspaceRoot: (root) => Effect.succeed(root),
  issueUrl: () => Effect.succeed({ relativeUrl: fakeUrl("workspace-file"), expiresAt: 999 }),
  authorizeGrant: async () => true,
  ...overrides,
});

const invoke = (
  provider: HostApiProvider,
  method: string,
  input: Parameters<HostApiProvider["invoke"]>[1],
  context: ViewContext,
  metadata = meta(provider),
) =>
  Effect.tryPromise({
    try: () => Promise.resolve(provider.invoke(method, input, context, signal, metadata)),
    catch: (cause) => new InvokeRejection({ cause }),
  });

const invokeError = (
  provider: HostApiProvider,
  method: string,
  input: Parameters<HostApiProvider["invoke"]>[1],
  context: ViewContext,
  metadata = meta(provider),
) =>
  invoke(provider, method, input, context, metadata).pipe(
    Effect.flip,
    Effect.map((rejection) => {
      if (!isOperationError(rejection.cause)) {
        throw new Error(`expected ExtensionOperationError, got ${String(rejection.cause)}`);
      }
      return rejection.cause;
    }),
  );

/** Project-scoped context: no threadId, so the scope resolver skips the thread lookup. */
const projectScopedContext = (): ViewContext => ({
  ...makeContext(),
  resource: {
    namespace: "test.extension",
    id: "surface",
    environmentId: "env",
    projectId: "project",
  },
});

const workspaceFileInput = {
  resource: { _tag: "workspace-file", threadId: "thread", path: "preview.svg" },
};

describe("t3.resources/lease adapter", () => {
  it.effect("mints a workspace-file lease for a granted caller", () =>
    Effect.gen(function* () {
      let issued: { resource: { _tag: string }; workspaceRoot?: string } | undefined;
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          issueUrl: (input) => {
            issued = input;
            return Effect.succeed({
              relativeUrl: fakeUrl("workspace-file-exact"),
              expiresAt: 1234,
            });
          },
        }),
      );
      const result = (yield* invoke(
        provider,
        "createPresentationUrl",
        workspaceFileInput,
        makeContext(),
      )) as { url: string; expiresAt: number; kind: string };
      expect(result.expiresAt).toBe(1234);
      // kind reports the CLAIM actually minted (an image mints an exact claim).
      expect(result.kind).toBe("workspace-file-exact");
      expect(issued?.resource._tag).toBe("workspace-file");
      expect(issued?.workspaceRoot).toBe(WORKSPACE);
      expect(result.url).toContain("/api/assets/");
    }),
  );

  it.effect("mints inside the thread worktree when one exists", () =>
    Effect.gen(function* () {
      let issued: { workspaceRoot?: string } | undefined;
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          threads: {
            getById: () =>
              Effect.succeed(
                Option.some({
                  projectId: ProjectId.make("project"),
                  worktreePath: "/repo/worktree",
                  deletedAt: null,
                }),
              ),
          },
          issueUrl: (input) => {
            issued = input;
            return Effect.succeed({ relativeUrl: fakeUrl("workspace-file"), expiresAt: 1 });
          },
        }),
      );
      const context: ViewContext = {
        ...makeContext(),
        workspaceRevision: extensionWorkspaceRevision(WORKSPACE, "/repo/worktree"),
      };
      yield* invoke(provider, "createPresentationUrl", workspaceFileInput, context);
      expect(issued?.workspaceRoot).toBe("/repo/worktree");
    }),
  );

  it.effect("denies a caller missing the kind's grant, before any mint", () =>
    Effect.gen(function* () {
      let minted = false;
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          authorizeGrant: async (callerId, grant) => {
            expect(callerId).toBe("caller");
            expect(grant).toBe(WORKSPACE_RESOURCES);
            return false;
          },
          issueUrl: () => {
            minted = true;
            return Effect.die("must not mint");
          },
        }),
      );
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        workspaceFileInput,
        makeContext(),
      );
      expect(error.detail).toContain("ResourceLeaseGrantDeniedError");
      expect(error.detail).toContain(WORKSPACE_RESOURCES);
      expect(minted).toBe(false);
    }),
  );

  it.effect("denies an intermediate caller in the chain that lacks the grant", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          authorizeGrant: async (callerId) => callerId !== "mid",
        }),
      );
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        workspaceFileInput,
        makeContext(),
        meta(provider, [{ pluginId: "mid", contentHash: "h", installationGeneration: 1 }]),
      );
      expect(error.detail).toContain("ResourceLeaseGrantDeniedError");
    }),
  );

  it.effect("denies attachment by name — no declared grant in this build", () =>
    Effect.gen(function* () {
      let minted = false;
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          issueUrl: () => {
            minted = true;
            return Effect.die("must not mint");
          },
        }),
      );
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        { resource: { _tag: "attachment", attachmentId: "att-1" } },
        makeContext(),
      );
      expect(error.detail).toContain("ResourceLeaseKindDeniedError");
      expect(error.detail).toContain("attachment");
      expect(minted).toBe(false);
    }),
  );

  it.effect("denies kinds outside the contract union by name (media-file)", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(makeDeps());
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        { resource: { _tag: "media-file", threadId: "thread", path: "/abs/video.mp4" } },
        makeContext(),
      );
      expect(error.detail).toContain("ResourceLeaseKindDeniedError");
      expect(error.detail).toContain("media-file");
    }),
  );

  it.effect("a missing thread fails AssetWorkspaceContextNotFoundError — native parity", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(
        makeDeps({ threads: { getById: () => Effect.succeed(Option.none()) } }),
      );
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        workspaceFileInput,
        projectScopedContext(),
      );
      expect(error.detail).toContain("AssetWorkspaceContextNotFoundError");
    }),
  );

  it.effect("a soft-deleted thread fails AssetWorkspaceContextNotFoundError", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          threads: {
            getById: () =>
              Effect.succeed(
                Option.some({
                  projectId: ProjectId.make("project"),
                  worktreePath: null,
                  deletedAt: "2026-09-13T00:00:00.000Z",
                }),
              ),
          },
        }),
      );
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        workspaceFileInput,
        projectScopedContext(),
      );
      expect(error.detail).toContain("AssetWorkspaceContextNotFoundError");
    }),
  );

  it.effect("a resource thread outside the granted project reads as not-found", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          threads: {
            getById: ({ threadId }) =>
              Effect.succeed(
                Option.some(
                  threadId === ThreadId.make("other-thread")
                    ? {
                        projectId: ProjectId.make("other-project"),
                        worktreePath: null,
                        deletedAt: null,
                      }
                    : {
                        projectId: ProjectId.make("project"),
                        worktreePath: null,
                        deletedAt: null,
                      },
                ),
              ),
          },
        }),
      );
      // The context thread stays inside the granted project; the resource
      // thread points elsewhere — reported as not-found, not a distinct
      // denial, so a granted caller cannot probe cross-project thread ids.
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        { resource: { _tag: "workspace-file", threadId: "other-thread", path: "a.svg" } },
        makeContext(),
      );
      expect(error.detail).toContain("AssetWorkspaceContextNotFoundError");
    }),
  );

  it.effect("mints a project-favicon lease rooted at the granted project", () =>
    Effect.gen(function* () {
      let issued: { resource: { _tag: string }; projectFaviconPath?: string } | undefined;
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          projects: {
            getById: () =>
              Effect.succeed(
                Option.some({
                  projectId: ProjectId.make("project"),
                  workspaceRoot: WORKSPACE,
                  faviconPath: "public/favicon.svg",
                  deletedAt: null,
                }),
              ),
          },
          issueUrl: (input) => {
            issued = input;
            return Effect.succeed({
              relativeUrl: fakeUrl("project-favicon", "favicon.svg"),
              expiresAt: 42,
            });
          },
        }),
      );
      const result = (yield* invoke(
        provider,
        "createPresentationUrl",
        { resource: { _tag: "project-favicon", cwd: WORKSPACE } },
        makeContext(),
      )) as { url: string; expiresAt: number; kind: string };
      expect(result.kind).toBe("project-favicon");
      expect(result.expiresAt).toBe(42);
      expect(issued?.projectFaviconPath).toBe("public/favicon.svg");
    }),
  );

  it.effect("a project-favicon cwd outside the granted project is denied", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(makeDeps());
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        { resource: { _tag: "project-favicon", cwd: "/elsewhere" } },
        makeContext(),
      );
      expect(error.detail).toContain("ResourceLeaseKindDeniedError");
      expect(error.detail).toContain("outside the granted project scope");
    }),
  );

  it.effect("native mint errors keep their tag (outside-root path)", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          issueUrl: () =>
            Effect.fail(
              new AssetWorkspacePathValidationError({
                resource: { _tag: "workspace-file", threadId: ThreadId.make("thread"), path: "x" },
                cause: new Error("escapes"),
              }),
            ),
        }),
      );
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        workspaceFileInput,
        makeContext(),
      );
      expect(error.detail).toContain("AssetWorkspacePathValidationError");
    }),
  );

  it.effect("re-checks authority after minting — revocation cancels the result", () =>
    Effect.gen(function* () {
      let minted = false;
      const provider = createResourcesLeaseApiProvider(
        makeDeps({
          issueUrl: () => {
            minted = true;
            return Effect.succeed({ relativeUrl: fakeUrl("workspace-file"), expiresAt: 1 });
          },
        }),
      );
      let issued = false;
      const error = yield* invokeError(
        provider,
        "createPresentationUrl",
        workspaceFileInput,
        makeContext(),
        meta(provider, [], async () => {
          issued = minted;
          throw new Error("revoked");
        }),
      );
      expect(error.detail).toContain("revoked");
      expect(issued).toBe(true);
    }),
  );

  it.effect("reports honest capabilities", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(makeDeps());
      const result = (yield* invoke(provider, "getCapabilities", {}, makeContext())) as {
        supportedKinds: string[];
      };
      expect(result.supportedKinds).toEqual(["workspace-file", "project-favicon"]);
    }),
  );

  it.effect("requires the orchestration read principal", () =>
    Effect.gen(function* () {
      const provider = createResourcesLeaseApiProvider(makeDeps());
      const { principal: _dropped, ...anonymous } = meta(provider);
      const error = yield* invokeError(provider, "getCapabilities", {}, makeContext(), anonymous);
      expect(error.detail).toContain("authority is unavailable");
    }),
  );
});
