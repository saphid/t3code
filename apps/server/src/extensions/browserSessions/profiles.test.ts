import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  BrowserEnginePageStatus,
  ExtensionOperationError,
  ProjectId,
  ThreadId,
  extensionWorkspaceRevision,
  type BrowserEngineHostCommandResultInput,
  type BrowserEngineHostStreamEvent,
  type BrowserEngineProfileCommand,
} from "@t3tools/contracts";
import {
  BROWSER_CLEAR_CACHE,
  BROWSER_CLEAR_COOKIES,
  BROWSER_IMPORT_COOKIES,
  BROWSER_OPERATE,
  BROWSER_PROFILES,
  BROWSER_SESSIONS,
  browserProfilesApi,
} from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type {
  HostApiInvocationMetadata,
  HostApiProvider,
  HostApiRootAuthority,
} from "@t3tools/extension-runtime";
import { createExtensionRuntime } from "@t3tools/extension-runtime";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProcessRunner from "../../processRunner.ts";
import * as BrowserEngineHosts from "../../preview/BrowserEngineHosts.ts";
import * as PreviewManager from "../../preview/Manager.ts";
import { createBrowserProfilesApiProvider } from "./profiles.ts";
import { createBrowserSessionsApiProvider } from "./v1.ts";

const isOperationError = Schema.is(ExtensionOperationError);
const signal = new AbortController().signal;
const ENV_ID = "env";
const PROJECT_ID = "project";
const THREAD_ID = "thread";
const WORKSPACE = "/repo/workspace";
const DESKTOP_SOCKET = { socketId: "desktop-ws", grantMethod: "desktop-bootstrap" } as const;

class InvokeRejection extends Data.TaggedError("InvokeRejection")<{ readonly cause: unknown }> {}

const context = (threadId: string | null = THREAD_ID): ViewContext => ({
  resource: {
    namespace: "test.extension",
    id: "view",
    environmentId: ENV_ID,
    projectId: PROJECT_ID,
    ...(threadId === null ? {} : { threadId }),
  },
  client: "test",
  workspaceRevision: extensionWorkspaceRevision(WORKSPACE, null),
});

const meta = (
  provider: HostApiProvider,
  scopes: readonly string[] = [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
): HostApiInvocationMetadata => ({
  callId: "call",
  rootCallerId: "t3.browser",
  callerId: "t3.browser",
  providerId: provider.providerId,
  providerGeneration: 1,
  callerGenerations: [],
  principal: { kind: "environment-session", id: "session", environmentId: ENV_ID, scopes },
  assertAuthority: async () => {},
});

const threads = {
  getById: (input: { readonly threadId: ThreadId }) =>
    Effect.succeed(
      input.threadId === THREAD_ID
        ? Option.some({
            projectId: ProjectId.make(PROJECT_ID),
            worktreePath: null,
            deletedAt: null,
          })
        : Option.none(),
    ),
};

const deps = (
  preview: PreviewManager.PreviewManager["Service"],
  engineHosts: BrowserEngineHosts.BrowserEngineHosts["Service"],
  importAckTimeoutMs = BrowserEngineHosts.IMPORT_ACK_TIMEOUT_MS,
) => ({
  environmentId: ENV_ID,
  projects: {
    getById: () =>
      Effect.succeedSome({
        projectId: ProjectId.make(PROJECT_ID),
        workspaceRoot: WORKSPACE,
        deletedAt: null,
      }),
  },
  threads,
  preview,
  engineHosts,
  importAckTimeoutMs,
});

const harnessWith = (options: { readonly importAckTimeoutMs?: number }) =>
  Effect.gen(function* () {
    const preview = yield* PreviewManager.PreviewManager;
    const engineHosts = yield* BrowserEngineHosts.BrowserEngineHosts;
    const importAckTimeoutMs = yield* BrowserEngineHosts.ImportAckTimeoutMs;
    return {
      preview,
      engineHosts,
      profiles: createBrowserProfilesApiProvider(deps(preview, engineHosts, importAckTimeoutMs)),
      sessions: createBrowserSessionsApiProvider(deps(preview, engineHosts)),
    };
  }).pipe(
    Effect.provide(
      BrowserEngineHosts.layer.pipe(
        Layer.provideMerge(PreviewManager.layer),
        Layer.provide(NodeServices.layer),
      ),
    ),
    Effect.provideService(
      BrowserEngineHosts.ImportAckTimeoutMs,
      options.importAckTimeoutMs ?? BrowserEngineHosts.IMPORT_ACK_TIMEOUT_MS,
    ),
  );
const harness = harnessWith({});

const invoke = (provider: HostApiProvider, method: string, input: unknown, ctx = context()) =>
  Effect.tryPromise({
    try: () =>
      Promise.resolve(provider.invoke(method, input as never, ctx, signal, meta(provider))),
    catch: (cause) => new InvokeRejection({ cause }),
  });

const invokeError = (...args: Parameters<typeof invoke>) =>
  invoke(...args).pipe(
    Effect.flip,
    Effect.map((rejection) => {
      if (!isOperationError(rejection.cause)) throw rejection.cause;
      return rejection.cause.detail;
    }),
  );

type Answer = BrowserEngineHostCommandResultInput["result"] | "silent";

const loadedStatus = Schema.decodeUnknownSync(BrowserEnginePageStatus)({
  navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "App" },
  canGoBack: false,
  canGoForward: false,
  zoomFactor: 1,
  appearance: "system",
  audioMuted: false,
  audible: false,
  favicon: null,
});

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ requires: Schema.Array(Schema.Struct({ id: Schema.String })) }),
  ),
);

const WORK_PROFILES: Answer = {
  outcome: "profiles",
  profiles: [
    { id: "default", name: "Default" },
    { id: "incognito", name: "Incognito" },
    { id: "work", name: "Work" },
  ],
  defaultProfileId: "default",
};

/**
 * Registers the desktop as the engine host and answers every profile frame
 * with `answer(command)`, recording what arrived. Page command frames queue
 * on `pageCommands`; import proceed/cancel frames queue on `controls`, and a
 * silent frame can be answered later through `respond`.
 */
const attachProfileHost = Effect.fn("test.attachProfileHost")(function* (
  engineHosts: BrowserEngineHosts.BrowserEngineHosts["Service"],
  answer: (command: BrowserEngineProfileCommand) => Answer,
) {
  const received: BrowserEngineProfileCommand[] = [];
  const arrivals = yield* Queue.unbounded<BrowserEngineProfileCommand>();
  const pageCommands = yield* Queue.unbounded<BrowserEngineHostStreamEvent>();
  const controls = yield* Queue.unbounded<BrowserEngineHostStreamEvent>();
  const commandIds: string[] = [];
  const registered = yield* Deferred.make<string>();
  const stream = yield* engineHosts.register(DESKTOP_SOCKET);
  let hostConnectionId = "";
  const fiber = yield* stream.pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        if (event.type === "registered") {
          hostConnectionId = event.hostConnectionId;
          yield* Deferred.succeed(registered, event.hostConnectionId);
          return;
        }
        if (event.type === "command") {
          yield* Queue.offer(pageCommands, event);
          return;
        }
        if (event.type !== "profile-command") {
          yield* Queue.offer(controls, event);
          return;
        }
        received.push(event.command);
        commandIds.push(event.commandId);
        yield* Queue.offer(arrivals, event.command);
        const result = answer(event.command);
        if (result === "silent") return;
        yield* engineHosts.commandResult(DESKTOP_SOCKET, {
          hostConnectionId,
          commandId: event.commandId,
          result,
        });
      }),
    ),
    Effect.forkScoped,
  );
  // Registration lands before the first command can be dispatched.
  yield* Deferred.await(registered);
  /** Answers the `index`th profile frame, as a host that kept the user waiting. */
  const respond = (index: number, result: BrowserEngineHostCommandResultInput["result"]) =>
    engineHosts.commandResult(DESKTOP_SOCKET, {
      hostConnectionId,
      commandId: commandIds[index]!,
      result,
    });
  return {
    received,
    arrivals,
    pageCommands,
    controls,
    commandIds,
    respond,
    fiber,
    hostConnectionId: () => hostConnectionId,
  };
});

const listProfilesOr =
  (other: (command: BrowserEngineProfileCommand) => Answer) =>
  (command: BrowserEngineProfileCommand): Answer =>
    command._tag === "listProfiles" ? WORK_PROFILES : other(command);

describe("browser profiles adapter", () => {
  it.effect("declares one distinct grant per capability", () =>
    Effect.sync(() => {
      const grants = Object.fromEntries(
        browserProfilesApi.definition.methods!.map((method) => [
          method.name,
          method.requiredGrants,
        ]),
      );
      expect(grants).toEqual({
        list: [BROWSER_PROFILES],
        open: [BROWSER_SESSIONS, BROWSER_OPERATE, BROWSER_PROFILES],
        clearCookies: [BROWSER_CLEAR_COOKIES],
        clearCache: [BROWSER_CLEAR_CACHE],
        listImportSources: [BROWSER_IMPORT_COOKIES],
        importCookies: [BROWSER_IMPORT_COOKIES],
      });
    }),
  );

  it.effect("every method fails desktop-required by name when no engine host is connected", () =>
    Effect.gen(function* () {
      const { profiles, preview } = yield* harness;
      const calls: ReadonlyArray<readonly [string, unknown]> = [
        ["list", {}],
        ["open", { profileId: "work" }],
        ["clearCookies", { profileId: "work" }],
        ["clearCache", { profileId: "work" }],
        ["listImportSources", {}],
        ["importCookies", { profileId: "work", sourceId: "chrome", sourceProfile: "p0" }],
      ];
      for (const [method, input] of calls) {
        const detail = yield* invokeError(profiles, method, input);
        expect(detail, method).toContain("BrowserProfilesUnsupported");
        expect(detail, method).toContain("(desktop-required)");
      }
      // Nothing was opened on the way to the refusal.
      expect((yield* preview.listDetails({ threadId: ThreadId.make(THREAD_ID) })).sessions).toEqual(
        [],
      );
    }),
  );

  it.effect("a host lacking an operation fails engine-unsupported, not desktop-required", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      yield* attachProfileHost(engineHosts, () => ({
        outcome: "rejected",
        reason: "not-applicable",
      }));
      const detail = yield* invokeError(profiles, "clearCache", { profileId: "work" });
      expect(detail).toContain("BrowserProfilesUnsupported");
      expect(detail).toContain("(engine-unsupported)");
    }),
  );

  it.effect("list projects opaque ids and names only", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      yield* attachProfileHost(engineHosts, () => WORK_PROFILES);
      expect(yield* invoke(profiles, "list", {})).toEqual({
        profiles: [
          { id: "default", name: "Default" },
          { id: "incognito", name: "Incognito" },
          { id: "work", name: "Work" },
        ],
        defaultProfileId: "default",
      });
    }),
  );

  it.effect("open fixes a known profile on the new session and refuses an unknown one", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts, preview } = yield* harness;
      yield* attachProfileHost(engineHosts, () => WORK_PROFILES);
      const receipt = (yield* invoke(profiles, "open", {
        profileId: "work",
        url: "localhost:5173",
      })) as { outcome: string; session: { profileId?: string; tabId: string } };
      expect(receipt.outcome).toBe("accepted");
      expect(receipt.session.profileId).toBe("work");

      const missing = yield* invokeError(profiles, "open", { profileId: "personal" });
      expect(missing).toContain("BrowserProfileNotFound");
      // The refused id minted no session (and so no orphan partition at attach).
      const listed = yield* preview.listDetails({ threadId: ThreadId.make(THREAD_ID) });
      expect(listed.sessions.map((entry) => entry.snapshot.profileId)).toEqual(["work"]);

      const threadless = yield* invokeError(profiles, "open", { profileId: "work" }, context(null));
      expect(threadless).toContain("thread-scoped");
    }),
  );

  it.effect("sessions.open refuses a profile: operate alone cannot choose one", () =>
    Effect.gen(function* () {
      const { sessions, engineHosts, preview } = yield* harness;
      yield* attachProfileHost(engineHosts, () => WORK_PROFILES);
      const detail = yield* invokeError(sessions, "open", {
        url: "localhost:5173",
        profileId: "work",
      });
      expect(detail).toContain("BrowserProfileGrantRequired");
      expect((yield* preview.listDetails({ threadId: ThreadId.make(THREAD_ID) })).sessions).toEqual(
        [],
      );
      // Without a profile it still opens under the default partition.
      const opened = (yield* invoke(sessions, "open", { url: "localhost:5173" })) as {
        session: { profileId?: string };
      };
      expect(opened.session.profileId).toBeUndefined();
    }),
  );

  it.effect("a session's profile survives guest crash recovery with the engine verbs", () =>
    Effect.gen(function* () {
      const { profiles, sessions, engineHosts } = yield* harness;
      const host = yield* attachProfileHost(engineHosts, () => WORK_PROFILES);
      const receipt = (yield* invoke(profiles, "open", {
        profileId: "work",
        url: "localhost:5173",
      })) as { serverEpoch: string; session: { tabId: string } };
      const fence = {
        hostConnectionId: host.hostConnectionId(),
        target: {
          threadId: ThreadId.make(THREAD_ID),
          tabId: receipt.session.tabId,
          serverEpoch: receipt.serverEpoch,
        },
        engineGeneration: "41",
      };
      yield* engineHosts.claim(DESKTOP_SOCKET, fence);
      const status = loadedStatus;
      yield* engineHosts.report(DESKTOP_SOCKET, { ...fence, status });
      yield* engineHosts.report(DESKTOP_SOCKET, { ...fence, lifecycle: "crashed" });
      yield* engineHosts.report(DESKTOP_SOCKET, { ...fence, lifecycle: "recovering" });
      // The replacement guest remounts from the session snapshot: new generation, same profile.
      yield* engineHosts.release(DESKTOP_SOCKET, fence);
      const replacement = { ...fence, engineGeneration: "42" };
      yield* engineHosts.claim(DESKTOP_SOCKET, replacement);
      yield* engineHosts.report(DESKTOP_SOCKET, { ...replacement, status });

      const listed = (yield* invoke(sessions, "list", {})) as {
        sessions: { profileId?: string; engine: unknown }[];
      };
      expect(listed.sessions).toHaveLength(1);
      expect(listed.sessions[0]!.profileId).toBe("work");
      expect(listed.sessions[0]!.engine).toEqual({ state: "ready", generation: "42" });

      // Engine verbs reach the recovered guest under its new generation.
      const reload = yield* Effect.forkChild(
        invoke(sessions, "reload", {
          tabId: receipt.session.tabId,
          serverEpoch: receipt.serverEpoch,
          expectedEngineGeneration: "42",
        }),
      );
      const frame = yield* Queue.take(host.pageCommands);
      if (frame.type !== "command") throw new Error("expected a page command");
      expect(frame.engineGeneration).toBe("42");
      yield* engineHosts.commandResult(DESKTOP_SOCKET, {
        hostConnectionId: host.hostConnectionId(),
        commandId: frame.commandId,
        result: { outcome: "applied" },
      });
      const reloaded = (yield* Fiber.join(reload)) as {
        outcome: string;
        session: { profileId?: string };
      };
      expect(reloaded.outcome).toBe("accepted");
      expect(reloaded.session.profileId).toBe("work");
    }),
  );

  it.effect("clearCookies and clearCache each reach the host for exactly the named profile", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      const host = yield* attachProfileHost(engineHosts, () => ({ outcome: "applied" }));
      expect(yield* invoke(profiles, "clearCookies", { profileId: "work" })).toEqual({
        outcome: "cleared",
        profileId: "work",
      });
      expect(yield* invoke(profiles, "clearCache", { profileId: "incognito" })).toEqual({
        outcome: "cleared",
        profileId: "incognito",
      });
      expect(host.received).toEqual([
        { _tag: "clearCookies", profileId: "work" },
        { _tag: "clearCache", profileId: "incognito" },
      ]);
      // There is no all-profiles clear: an absent profile never reaches the host.
      const unnamed = yield* invokeError(profiles, "clearCookies", {});
      expect(unnamed).toContain("BrowserProfileInputError");
      expect(host.received).toHaveLength(2);
    }),
  );

  it.effect("a clear the host cannot map to a profile fails by name", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      yield* attachProfileHost(engineHosts, () => ({
        outcome: "rejected",
        reason: "unknown-profile",
      }));
      expect(yield* invokeError(profiles, "clearCookies", { profileId: "gone" })).toContain(
        "BrowserProfileNotFound",
      );
    }),
  );

  it.effect("a host that disconnects mid-clear yields unknown, never cleared", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      const host = yield* attachProfileHost(engineHosts, () => "silent");
      const pending = yield* Effect.forkChild(
        invoke(profiles, "clearCookies", { profileId: "work" }),
      );
      yield* Queue.take(host.arrivals);
      yield* Fiber.interrupt(host.fiber);
      expect(yield* Fiber.join(pending)).toEqual({ outcome: "unknown", profileId: "work" });
    }),
  );

  it.effect("cookie import sends a handle and the requester, and returns counts only", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      const host = yield* attachProfileHost(
        engineHosts,
        listProfilesOr((command) =>
          command._tag === "listImportSources"
            ? {
                outcome: "import-sources",
                sources: [
                  {
                    id: "chrome",
                    name: "Google Chrome",
                    profiles: [{ handle: "p0", name: "Person 1", cookieCount: 12 }],
                  },
                  {
                    id: "safari",
                    name: "Safari",
                    unavailable: "needsFullDiskAccess",
                    profiles: [],
                  },
                ],
              }
            : { outcome: "imported", imported: 10, skipped: 2 },
        ),
      );
      expect(yield* invoke(profiles, "listImportSources", {})).toEqual({
        sources: [
          {
            id: "chrome",
            name: "Google Chrome",
            profiles: [{ handle: "p0", name: "Person 1", cookieCount: 12 }],
          },
          { id: "safari", name: "Safari", unavailable: "needsFullDiskAccess", profiles: [] },
        ],
      });
      expect(
        yield* invoke(profiles, "importCookies", {
          profileId: "work",
          sourceId: "chrome",
          sourceProfile: "p0",
        }),
      ).toEqual({ outcome: "imported", profileId: "work", imported: 10, skipped: 2 });
      expect(host.received.at(-1)).toEqual({
        _tag: "importCookies",
        profileId: "work",
        sourceId: "chrome",
        sourceProfile: "p0",
        requester: "t3.browser",
      });
      // Directories never pass the public schema.
      expect(
        yield* invokeError(profiles, "importCookies", {
          profileId: "work",
          sourceId: "chrome",
          sourceProfile: "p0",
          sourceProfileDirectory: "Profile 1",
        }),
      ).toContain("BrowserProfileInputError");
      expect(
        yield* invokeError(profiles, "importCookies", {
          profileId: "work",
          sourceId: "netscape",
          sourceProfile: "p0",
        }),
      ).toContain("BrowserProfileInputError");
    }),
  );

  it.effect("authority lost while the prompt is open cancels once the user confirms", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      const host = yield* attachProfileHost(engineHosts, () => "silent");
      let authorized = true;
      const metadata: HostApiInvocationMetadata = {
        ...meta(profiles),
        assertAuthority: async () => {
          if (!authorized) throw new Error("revoked");
        },
      };
      const importing = yield* Effect.forkChild(
        Effect.tryPromise({
          try: () =>
            Promise.resolve(
              profiles.invoke(
                "importCookies",
                { profileId: "work", sourceId: "chrome", sourceProfile: "p0" },
                context(),
                signal,
                metadata,
              ),
            ),
          catch: (cause) => new InvokeRejection({ cause }),
        }),
      );
      yield* Queue.take(host.arrivals);
      authorized = false;
      yield* host.respond(0, { outcome: "confirmed" });
      expect(yield* Queue.take(host.controls)).toEqual({
        type: "profile-command-cancel",
        commandId: host.commandIds[0],
      });
      const refused = yield* Fiber.join(importing).pipe(Effect.flip);
      expect(isOperationError(refused.cause) && refused.cause.detail).toContain(
        "authority was revoked",
      );
      expect(yield* Queue.size(host.controls)).toBe(0);
    }),
  );

  it.effect("declined and failed imports come back as closed outcomes", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      const answers: Answer[] = [
        { outcome: "declined" },
        { outcome: "import-failed", reason: "browserRunning" },
        // New-profile bookkeeping cannot occur for an existing target.
        { outcome: "import-failed", reason: "profileLimitReached" },
      ];
      yield* attachProfileHost(engineHosts, () => answers.shift()!);
      const input = { profileId: "work", sourceId: "chrome", sourceProfile: "p0" };
      expect(yield* invoke(profiles, "importCookies", input)).toEqual({
        outcome: "declined",
        profileId: "work",
      });
      expect(yield* invoke(profiles, "importCookies", input)).toEqual({
        outcome: "failed",
        profileId: "work",
        reason: "browserRunning",
      });
      expect(yield* invoke(profiles, "importCookies", input)).toEqual({
        outcome: "failed",
        profileId: "work",
        reason: "readFailed",
      });
    }),
  );

  it.effect("read-only principals cannot clear, import or open", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      const host = yield* attachProfileHost(engineHosts, () => ({ outcome: "applied" }));
      for (const method of ["open", "clearCookies", "clearCache", "importCookies"]) {
        const refused = yield* Effect.tryPromise({
          try: () =>
            Promise.resolve(
              profiles.invoke(
                method,
                { profileId: "work", sourceId: "chrome", sourceProfile: "p0" } as never,
                context(),
                signal,
                meta(profiles, [AuthOrchestrationReadScope]),
              ),
            ),
          catch: (cause) => new InvokeRejection({ cause }),
        }).pipe(Effect.flip);
        expect(isOperationError(refused.cause), method).toBe(true);
      }
      expect(host.received).toEqual([]);
    }),
  );
});

/**
 * The real extension runtime and broker around `profiles`, with the browser
 * profiles example installed as a consumer that declares only
 * `t3.browser/profiles`, so grants alone decide.
 */
const brokerRuntime = Effect.fn("test.brokerRuntime")(function* (
  profiles: HostApiProvider,
  options: { readonly timeoutMs?: number; readonly grants?: ReadonlyArray<string> } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packages = path.resolve(import.meta.dirname, "../../../../../packages");
  const exampleDir = path.join(packages, "extension-sdk/examples/browser-profiles");
  const runner = yield* ProcessRunner.ProcessRunner;
  const built = yield* runner.run({
    command: "node",
    args: [path.join(packages, "extension-sdk/bin/t3-extension.mjs"), "build", exampleDir],
  });
  expect(built.code, built.stderr).toBe(0);
  const rootDir = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "s7a-profiles-" }),
  );
  const runtime = yield* Effect.promise(() =>
    createExtensionRuntime({
      rootDir,
      environmentId: ENV_ID,
      services: [],
      apiProviders: [profiles],
      authorize: (installation, grant, ctx) =>
        installation.grants.capabilities.includes(grant) &&
        installation.grants.projectIds.includes(ctx.resource.projectId ?? ""),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }),
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()));
  const installed = yield* Effect.promise(() =>
    runtime.install(path.join(exampleDir, ".t3-extension"), {
      capabilities: [...(options.grants ?? [])],
      projectIds: [PROJECT_ID],
    }),
  );
  const root: HostApiRootAuthority = {
    principal: meta(profiles).principal!,
    allowWrite: true,
    revalidate: () => {},
  };
  const call = (method: string, input: Record<string, unknown>) =>
    runtime.invokeApi(
      installed.id,
      installed.contentHash,
      {
        id: BROWSER_PROFILES,
        versionRange: "^1.0.0",
        method,
        input: input as never,
        context: context(),
      },
      new AbortController().signal,
      root,
    );
  return { runtime, installed, call };
});

describe("browser profiles grants through the broker", () => {
  it.effect("each grant unlocks its own method and implies none of the others", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      yield* attachProfileHost(
        engineHosts,
        listProfilesOr((command) =>
          command._tag === "listImportSources"
            ? { outcome: "import-sources", sources: [] }
            : command._tag === "importCookies"
              ? { outcome: "declined" }
              : { outcome: "applied" },
        ),
      );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const packages = path.resolve(import.meta.dirname, "../../../../../packages");
      // The browser pack's committed bundle declares the contract it consumes.
      const packManifest = yield* decodeManifest(
        yield* fs.readFileString(
          path.join(packages, "first-party-extensions/browser/.t3-extension/t3-extension.json"),
        ),
      );
      expect(packManifest.requires.map((entry) => entry.id)).toContain(BROWSER_PROFILES);

      const { runtime, installed, call } = yield* brokerRuntime(profiles);
      const calls: Record<string, Record<string, unknown>> = {
        list: {},
        clearCookies: { profileId: "work" },
        clearCache: { profileId: "work" },
        listImportSources: {},
        importCookies: { profileId: "work", sourceId: "chrome", sourceProfile: "p0" },
      };
      const grantFor: Record<string, string> = {
        list: BROWSER_PROFILES,
        clearCookies: BROWSER_CLEAR_COOKIES,
        clearCache: BROWSER_CLEAR_CACHE,
        listImportSources: BROWSER_IMPORT_COOKIES,
        importCookies: BROWSER_IMPORT_COOKIES,
      };
      for (const held of [
        BROWSER_PROFILES,
        BROWSER_CLEAR_COOKIES,
        BROWSER_CLEAR_CACHE,
        BROWSER_IMPORT_COOKIES,
      ]) {
        yield* Effect.promise(() =>
          runtime.updateGrants(installed.id, { capabilities: [held], projectIds: [PROJECT_ID] }),
        );
        for (const [method, input] of Object.entries(calls)) {
          const outcome = yield* Effect.promise(() =>
            call(method, input).then(
              () => "allowed",
              (error: unknown) => (error instanceof Error ? error.message : String(error)),
            ),
          );
          if (grantFor[method] === held) expect(outcome, `${held} → ${method}`).toBe("allowed");
          else
            expect(outcome, `${held} → ${method}`).toContain(
              `API capability denied: ${grantFor[method]}`,
            );
        }
      }
      // Opening under a profile needs the profiles grant on top of operate.
      yield* Effect.promise(() =>
        runtime.updateGrants(installed.id, {
          capabilities: [BROWSER_SESSIONS, BROWSER_OPERATE],
          projectIds: [PROJECT_ID],
        }),
      );
      yield* Effect.promise(() =>
        expect(call("open", { profileId: "work" })).rejects.toThrow(
          `API capability denied: ${BROWSER_PROFILES}`,
        ),
      );
      yield* Effect.promise(() =>
        runtime.updateGrants(installed.id, {
          capabilities: [BROWSER_SESSIONS, BROWSER_OPERATE, BROWSER_PROFILES],
          projectIds: [PROJECT_ID],
        }),
      );
      const opened = (yield* Effect.promise(() => call("open", { profileId: "work" }))) as {
        session: { profileId?: string };
      };
      expect(opened.session.profileId).toBe("work");

      // The broker's schema gate runs before any grant is consulted: no
      // all-profiles clear and no source directory ever reach the adapter.
      yield* Effect.promise(() =>
        runtime.updateGrants(installed.id, {
          capabilities: [BROWSER_CLEAR_COOKIES, BROWSER_IMPORT_COOKIES],
          projectIds: [PROJECT_ID],
        }),
      );
      yield* Effect.promise(() =>
        expect(call("clearCookies", {})).rejects.toThrow("API input does not match schema"),
      );
      yield* Effect.promise(() =>
        expect(
          call("importCookies", {
            profileId: "work",
            sourceId: "chrome",
            sourceProfile: "p0",
            sourceProfileDirectory: "Profile 1",
          }),
        ).rejects.toThrow("API input does not match schema"),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
  );

  const IMPORT_INPUT = { profileId: "work", sourceId: "chrome", sourceProfile: "p0" };
  const settled = <A>(promise: Promise<A>) =>
    Effect.promise(() =>
      promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      ),
    );

  it.effect("an import outlives the broker's default deadline and still returns its outcome", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harnessWith({ importAckTimeoutMs: 400 });
      const host = yield* attachProfileHost(engineHosts, () => "silent");
      const { call } = yield* brokerRuntime(profiles, {
        timeoutMs: 50,
        grants: [BROWSER_PROFILES, BROWSER_IMPORT_COOKIES],
      });

      // The user takes longer than the default deadline to confirm: a list
      // issued after the import expires under that deadline first.
      const importing = call("importCookies", IMPORT_INPUT);
      yield* Queue.take(host.arrivals);
      const listed = yield* settled(call("list", {}));
      expect(listed).toEqual({ error: "API deadline exceeded" });
      yield* host.respond(0, { outcome: "confirmed" });
      expect(yield* Queue.take(host.controls)).toMatchObject({ type: "profile-command-proceed" });
      yield* host.respond(0, { outcome: "imported", imported: 5, skipped: 1 });
      expect(yield* settled(importing)).toEqual({
        value: { outcome: "imported", profileId: "work", imported: 5, skipped: 1 },
      });

      // A prompt nobody answers expires on the import wait, not the broker's:
      // the caller gets `unknown` and the host is told to take it down.
      const abandoned = call("importCookies", IMPORT_INPUT);
      yield* Queue.take(host.arrivals);
      expect(yield* settled(abandoned)).toEqual({
        value: { outcome: "unknown", profileId: "work" },
      });
      expect(yield* Queue.take(host.controls)).toEqual({
        type: "profile-command-cancel",
        commandId: host.commandIds.at(-1),
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
  );

  it.effect("revoking the grant while the prompt is open cancels the import on the host", () =>
    Effect.gen(function* () {
      const { profiles, engineHosts } = yield* harness;
      const host = yield* attachProfileHost(
        engineHosts,
        listProfilesOr(() => "silent"),
      );
      const { runtime, installed, call } = yield* brokerRuntime(profiles, {
        grants: [BROWSER_IMPORT_COOKIES],
      });
      const importing = call("importCookies", IMPORT_INPUT);
      yield* Queue.take(host.arrivals);
      yield* Effect.promise(() =>
        runtime.updateGrants(installed.id, { capabilities: [], projectIds: [PROJECT_ID] }),
      );
      expect(yield* settled(importing)).toEqual({ error: "API configuration changed" });
      expect(yield* Queue.take(host.controls)).toEqual({
        type: "profile-command-cancel",
        commandId: host.commandIds[0],
      });
      // The user accepts the prompt anyway: nothing tells the host to proceed.
      yield* host.respond(0, { outcome: "confirmed" });
      expect(yield* Queue.size(host.controls)).toBe(0);
    }).pipe(
      Effect.scoped,
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
  );
});
