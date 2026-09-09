import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ExtensionInvokeInput, ProjectId } from "@t3tools/contracts";
import { createExtensionRuntime } from "@t3tools/extension-runtime";
import { validateEnvironmentPackage } from "@t3tools/extension-sdk/environment";
import { WORKSPACE_READ_TEXT } from "@t3tools/extension-sdk/workspace";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import {
  ProjectionProject,
  ProjectionProjectRepository,
} from "../persistence/Services/ProjectionProjects.ts";
import {
  ProjectionThread,
  ProjectionThreadRepository,
} from "../persistence/Services/ProjectionThreads.ts";
import { WorkspaceFileSystem } from "../workspace/WorkspaceFileSystem.ts";
import { toSdkContext } from "./scope.ts";
import { make } from "./EnvironmentExtensions.ts";

const project = Schema.decodeUnknownSync(ProjectionProject)({
  projectId: "project-a",
  title: "Fixture",
  workspaceRoot: "/project",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  scripts: [],
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  deletedAt: null,
});
const originalThread = Schema.decodeUnknownSync(ProjectionThread)({
  threadId: "thread-a",
  projectId: "project-a",
  title: "Fixture",
  modelSelection: { instanceId: "codex", model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: "/worktree",
  latestTurnId: null,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  unsettledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  pinnedAt: null,
  latestUserMessageAt: null,
  pendingApprovalCount: 0,
  pendingUserInputCount: 0,
  hasActionableProposedPlan: 0,
  deletedAt: null,
});
const hash = "a".repeat(64);
const pkg = validateEnvironmentPackage({
  format: 1,
  manifest: { id: "fixture.reader", version: "1.0.0", apiVersion: 1, surfaces: [] },
  serverEntry: "server.mjs",
  tools: [
    {
      id: "fixture.reader/read",
      title: "Read",
      description: "Read fixture",
      inputSchema: { type: "object" },
      readOnly: true,
      capabilities: [WORKSPACE_READ_TEXT],
    },
  ],
});
const invoke = Schema.decodeUnknownSync(ExtensionInvokeInput)({
  toolId: "fixture.reader/read",
  input: { relativePath: "new.txt" },
  expectedContentHash: hash,
  context: {
    resource: {
      namespace: "fixture.reader",
      id: "file",
      environmentId: "env-a",
      projectId: "project-a",
      threadId: "thread-a",
    },
    workspaceRevision: JSON.stringify(["/project", "/worktree"]),
    client: "web",
  },
});
function fixture() {
  let thread = originalThread;
  let entry = {
    id: "fixture.reader",
    contentHash: hash,
    package: pkg,
    enabled: true,
    grants: { capabilities: [WORKSPACE_READ_TEXT], projectIds: ["project-a"] },
  };
  let options: Parameters<typeof createExtensionRuntime>[0] | undefined;
  const calls: Array<{ cwd: string; relativePath: string }> = [];
  let afterRead = () => {};
  let afterInvoke = () => {};
  let afterClient = () => {};
  let disposed = false;
  const runtime: Awaited<ReturnType<typeof createExtensionRuntime>> = {
    list: () => [entry],
    install: async () => entry,
    enable: async () => entry,
    disable: async () => {
      entry = { ...entry, enabled: false };
      return entry;
    },
    remove: async () => {},
    update: async () => entry,
    readClient: async () => {
      afterClient();
      return { code: "export default null", contentHash: hash };
    },
    invoke: async () => {
      afterInvoke();
      return { ok: true };
    },
    dispose: async () => {
      disposed = true;
    },
  };
  const factory: typeof createExtensionRuntime = async (value) => {
    options = value;
    return runtime;
  };
  const services = Layer.mergeAll(
    Layer.succeed(ServerEnvironment.ServerEnvironment, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-a")),
      getDescriptor: Effect.die("unused"),
    }),
    Layer.succeed(ProjectionProjectRepository, {
      getById: () => Effect.succeed(Option.some(project)),
      upsert: () => Effect.void,
      listAll: () => Effect.succeed([project]),
      deleteById: () => Effect.void,
    }),
    Layer.succeed(ProjectionThreadRepository, {
      getById: () => Effect.succeed(Option.some(thread)),
      upsert: () => Effect.void,
      listByProjectId: () => Effect.succeed([thread]),
      deleteById: () => Effect.void,
    }),
    Layer.succeed(WorkspaceFileSystem, {
      readFile: (input) =>
        Effect.sync(() => {
          calls.push(input);
          afterRead();
          return {
            relativePath: input.relativePath,
            contents: "hello",
            byteLength: 5,
            truncated: false,
          };
        }),
      writeFile: () => Effect.die("unused"),
    }),
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-extension-service-test-" }),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return {
    factory,
    services,
    runtime,
    calls,
    getOptions: () => {
      if (!options) throw new Error("Runtime not constructed");
      return options;
    },
    changeWorkspace: () => {
      thread = { ...thread, worktreePath: "/changed" };
    },
    afterRead: (fn: () => void) => {
      afterRead = fn;
    },
    afterInvoke: (fn: () => void) => {
      afterInvoke = fn;
    },
    afterClient: (fn: () => void) => {
      afterClient = fn;
    },
    isDisposed: () => disposed,
    revoke: () => {
      entry = { ...entry, enabled: false };
    },
  };
}
it.effect(
  "corrupt runtime startup leaves a constructible service with explicit operation errors",
  () => {
    const f = fixture();
    return Effect.scoped(
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(config.stateDir, "extensions");
        const file = path.join(root, "installations.json");
        yield* fs.makeDirectory(root, { recursive: true });
        yield* fs.writeFileString(file, "{broken");
        const service = yield* make();
        const error = yield* Effect.flip(service.list);
        expect(error._tag).toBe("ExtensionOperationError");
        expect(error.operation).toBe("initialize");
        expect(yield* fs.readFileString(file)).toBe("{broken");
      }).pipe(Effect.provide(f.services)),
    );
  },
);
it.effect(
  "workspace reads use derived cwd, deny relative escapes and suppress a stale result",
  () => {
    const f = fixture();
    return Effect.scoped(
      Effect.gen(function* () {
        yield* make(f.factory);
        const service = f.getOptions().services[0]!;
        const signal = new AbortController().signal;
        const result = yield* Effect.promise(() =>
          Promise.resolve(
            service.invoke({ relativePath: "new.txt" }, toSdkContext(invoke.context), signal),
          ),
        );
        expect(result).toEqual({
          relativePath: "new.txt",
          contents: "hello",
          byteLength: 5,
          truncated: false,
        });
        expect(f.calls).toEqual([{ cwd: "/worktree", relativePath: "new.txt" }]);
        yield* Effect.promise(() =>
          expect(
            service.invoke({ relativePath: "../private" }, toSdkContext(invoke.context), signal),
          ).rejects.toThrow(),
        );
        expect(f.calls.length).toBe(1);
        f.afterRead(f.changeWorkspace);
        yield* Effect.promise(() =>
          expect(
            service.invoke({ relativePath: "new.txt" }, toSdkContext(invoke.context), signal),
          ).rejects.toThrow(),
        );
      }).pipe(Effect.provide(f.services)),
    );
  },
);
it.effect(
  "outer invocation rechecks scope even for a pure tool and client delivery rechecks revocation",
  () => {
    const f = fixture();
    return Effect.scoped(
      Effect.gen(function* () {
        const service = yield* make(f.factory);
        f.afterInvoke(f.changeWorkspace);
        expect((yield* Effect.flip(service.invoke(invoke))).detail).toContain("stale");
        f.afterClient(f.revoke);
        expect((yield* Effect.flip(service.client("fixture.reader", hash))).detail).toContain(
          "unavailable",
        );
      }).pipe(Effect.provide(f.services)),
    );
  },
);
it.effect("catalog and host authorization require independent install/project grants", () => {
  const f = fixture();
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* make(f.factory);
      expect((yield* service.tools(toSdkContext(invoke.context))).length).toBe(1);
      const authorize = f.getOptions().authorize;
      const entry = f.runtime.list()[0]!;
      expect(
        yield* Effect.promise(() =>
          Promise.resolve(authorize(entry, WORKSPACE_READ_TEXT, toSdkContext(invoke.context))),
        ),
      ).toBe(true);
      expect(
        yield* Effect.promise(() =>
          Promise.resolve(
            authorize(
              { ...entry, grants: { ...entry.grants, projectIds: [ProjectId.make("other")] } },
              WORKSPACE_READ_TEXT,
              toSdkContext(invoke.context),
            ),
          ),
        ),
      ).toBe(false);
      f.revoke();
      expect(yield* service.tools(toSdkContext(invoke.context))).toEqual([]);
    }).pipe(Effect.provide(f.services)),
  );
});

it.effect("update requires explicit trusted-code confirmation before calling the runtime", () => {
  const f = fixture();
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* make(f.factory);
      expect(
        (yield* Effect.flip(
          service.manage({ id: "fixture.reader", action: "update", sourceDir: "/fixture" }),
        )).detail,
      ).toContain("trusted-code");
      expect(
        (yield* service.manage({
          id: "fixture.reader",
          action: "update",
          sourceDir: "/fixture",
          trusted: true,
        }))?.contentHash,
      ).toBe(hash);
    }).pipe(Effect.provide(f.services)),
  );
});
