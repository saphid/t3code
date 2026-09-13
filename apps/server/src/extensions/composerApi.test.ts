import {
  AuthOrchestrationReadScope,
  ExtensionOperationError,
  ProjectId,
  ThreadId,
  extensionWorkspaceRevision,
} from "@t3tools/contracts";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type {
  ComposerCapabilities,
  MessagesEnrichmentCapabilities,
} from "@t3tools/extension-sdk/catalogue";
import type { HostApiProvider } from "@t3tools/extension-runtime";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { createComposerApiProviders } from "./composerApi.ts";

const isOperationError = Schema.is(ExtensionOperationError);
const signal = new AbortController().signal;
const WORKSPACE = "/repo/workspace";

const makeContext = (threadId: string | null = "thread"): ViewContext => ({
  resource: {
    namespace: "test.extension",
    id: "surface",
    environmentId: "env",
    projectId: "project",
    ...(threadId === null ? {} : { threadId }),
  },
  client: "test",
  workspaceRevision: extensionWorkspaceRevision(WORKSPACE, null),
});

const providers = createComposerApiProviders({
  environmentId: "env",
  projects: {
    getById: () =>
      Effect.succeedSome({
        projectId: ProjectId.make("project"),
        workspaceRoot: WORKSPACE,
        deletedAt: null,
      }),
  },
  threads: {
    getById: (input) =>
      Effect.succeed(
        input.threadId === ThreadId.make("thread")
          ? Option.some({
              projectId: ProjectId.make("project"),
              worktreePath: null,
              deletedAt: null,
            })
          : Option.none(),
      ),
  },
});
const composer = providers.find((p) => p.providerId === "host.composer")!;
const messages = providers.find((p) => p.providerId === "host.messages")!;

const meta = (provider: HostApiProvider): Parameters<HostApiProvider["invoke"]>[4] => ({
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
    scopes: [AuthOrchestrationReadScope],
  },
  assertAuthority: async () => {},
});

const call = (
  provider: HostApiProvider,
  method: string,
  input: Json,
  context = makeContext(),
): Promise<Json> =>
  Promise.resolve(provider.invoke(method, input, context, signal, meta(provider)));

const expectNamedError = async (pending: Promise<Json>, operation: string, detail: RegExp) => {
  const error = await pending.then(
    () => {
      throw new Error("expected failure");
    },
    (cause: unknown) => cause,
  );
  expect(isOperationError(error)).toBe(true);
  if (isOperationError(error)) {
    expect(error.operation).toBe(operation);
    expect(error.detail).toMatch(detail);
  }
};

it.effect("reports the transport gap honestly through getCapabilities", () =>
  Effect.promise(async () => {
    const composerCaps = (await call(composer, "getCapabilities", {})) as ComposerCapabilities;
    expect(composerCaps).toEqual({
      adapter: "host.composer",
      transport: "unavailable",
      detail: expect.stringContaining("client-local"),
      operations: { insertContext: false, getDraftState: false },
    });
    const messageCaps = (await call(
      messages,
      "getCapabilities",
      {},
    )) as MessagesEnrichmentCapabilities;
    expect(messageCaps.adapter).toBe("host.messages");
    expect(messageCaps.transport).toBe("unavailable");
    expect(messageCaps.operations).toEqual({ attachAnnotation: false });
  }),
);

it.effect("fails state ops with a named unsupported error after valid scope and input", () =>
  Effect.promise(async () => {
    await expectNamedError(
      call(composer, "insertContext", {
        refs: [{ path: "src/a.ts", startLine: 1, endLine: 4, excerpt: "const a = 1" }],
      }),
      "composer.context.insertContext",
      /unavailable.*client-local/,
    );
    await expectNamedError(
      call(composer, "getDraftState", {}),
      "composer.context.getDraftState",
      /unavailable.*client-local/,
    );
    await expectNamedError(
      call(messages, "attachAnnotation", {
        annotation: { filePath: "src/a.ts", startLine: 1, endLine: 2, body: "rename this" },
      }),
      "messages.enrichment.attachAnnotation",
      /unavailable.*client-local/,
    );
  }),
);

it.effect("rejects malformed and over-bounds payloads with a named error, not a crash", () =>
  Effect.promise(async () => {
    for (const input of [
      { refs: [] },
      { refs: Array.from({ length: 9 }, () => ({ path: "a" })) },
      { refs: [{ path: "" }] },
      { refs: [{ path: "a".repeat(513) }] },
      { refs: [{ path: "a", startLine: 0 }] },
      { refs: [{ path: "a" }], extra: true },
      { refs: [{ path: "a", surprise: 1 }] },
      "not-an-object",
    ]) {
      await expectNamedError(
        call(composer, "insertContext", input as Json),
        "composer.context.insertContext",
        /Invalid/,
      );
    }
    for (const input of [
      { annotation: { filePath: "a", startLine: 1, endLine: 2 } },
      { annotation: { filePath: "a", startLine: 1, endLine: 2, body: "" } },
      { annotation: { filePath: "a", startLine: 1, endLine: 2, body: "x", extra: 1 } },
      { annotation: null },
    ]) {
      await expectNamedError(
        call(messages, "attachAnnotation", input as Json),
        "messages.enrichment.attachAnnotation",
        /Invalid/,
      );
    }
  }),
);

it.effect("rejects foreign threads, foreign environments, and thread-less contexts", () =>
  Effect.promise(async () => {
    // An input threadId must equal the granted context's thread.
    await expectNamedError(
      call(composer, "insertContext", {
        threadId: "other-thread",
        refs: [{ path: "a" }],
      }),
      "composer.context.insertContext",
      /outside the granted thread scope/,
    );
    // A context without a thread cannot target a draft.
    await expectNamedError(
      call(
        messages,
        "attachAnnotation",
        {
          annotation: { filePath: "a", startLine: 1, endLine: 2, body: "x" },
        },
        makeContext(null),
      ),
      "messages.enrichment.attachAnnotation",
      /thread-scoped/,
    );
    // Foreign environments fail scope resolution before the unsupported error.
    const foreign = makeContext();
    const foreignContext: ViewContext = {
      ...foreign,
      resource: { ...foreign.resource, environmentId: "other" },
    };
    await expectNamedError(
      call(composer, "insertContext", { refs: [{ path: "a" }] }, foreignContext),
      "scope",
      /environment/,
    );
    // Unknown methods fail named, not silently.
    await expectNamedError(
      call(composer, "sendMessage", { text: "hi" }),
      "composer.context",
      /unavailable/,
    );
  }),
);

it.effect("enforces matching context thread on getDraftState too", () =>
  Effect.promise(async () => {
    await expectNamedError(
      call(composer, "getDraftState", { threadId: "other-thread" }),
      "composer.context.getDraftState",
      /outside the granted thread scope/,
    );
    // Matching threadId passes scope and reaches the honest unsupported error.
    await expectNamedError(
      call(composer, "getDraftState", { threadId: "thread" }),
      "composer.context.getDraftState",
      /unavailable.*client-local/,
    );
  }),
);
