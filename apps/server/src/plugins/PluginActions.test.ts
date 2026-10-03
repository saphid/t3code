import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  PluginActionId,
  PluginId,
  PluginInstallationId,
  ProjectId,
  ThreadId,
  type PluginActionsSnapshot,
  type PluginInstallation,
} from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PluginActions from "./PluginActions.ts";
import * as PluginCatalog from "./PluginCatalog.ts";
import { loadPluginDirectory } from "./PluginManifestLoader.ts";
import * as PluginSupervisor from "./PluginSupervisor.ts";

// Children run the real CLI entry, which routes `__plugin-host` to the child runtime.
const BIN_PATH = `${import.meta.dirname}/../bin.ts`;
const FIXTURE = `${import.meta.dirname}/testFixtures/actions`;

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const THREAD = ThreadId.make("thread-1");
const PROJECT = ProjectId.make("project-1");

/** One thread in one project; every other target does not exist. */
const resolveTarget = PluginActions.resolvePluginActionTargetFrom({
  getThreadShell: (threadId) =>
    Effect.succeed(
      threadId === THREAD ? { projectId: PROJECT, worktreePath: null, branch: "main" } : null,
    ),
  getProjectShell: (projectId) =>
    Effect.succeed(
      projectId === PROJECT ? Option.some({ workspaceRoot: "/work/project" }) : Option.none(),
    ),
});

const startActions = Effect.fn("startActions")(function* (scope: Scope.Scope) {
  const supervisor = yield* PluginSupervisor.make({
    heapLimitMb: 64,
    activationTimeout: "10 seconds",
    stopGrace: "1 second",
  }).pipe(
    Effect.provideService(HostProcessArguments, [process.execPath, BIN_PATH]),
    Effect.provideService(Scope.Scope, scope),
  );
  const catalog = yield* PluginCatalog.make().pipe(
    Effect.provideService(PluginSupervisor.PluginSupervisor, supervisor),
    Effect.provideService(Scope.Scope, scope),
  );
  return { catalog, actions: PluginActions.makePluginActions({ catalog, resolveTarget }) };
});

/** Copies the fixture (or a variant of its manifest) into a fresh directory. */
const preparePlugin = Effect.fn("preparePlugin")(function* (
  manifest?: (manifest: Record<string, unknown>) => Record<string, unknown>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(
    yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-actions-" }),
    "plugin",
  );
  yield* fs.makeDirectory(directory);
  yield* fs.writeFileString(
    path.join(directory, "main.mjs"),
    yield* fs.readFileString(path.join(FIXTURE, "main.mjs")),
  );
  const original = JSON.parse(yield* fs.readFileString(path.join(FIXTURE, "t3-plugin.json")));
  yield* fs.writeFileString(
    path.join(directory, "t3-plugin.json"),
    toJson(manifest ? manifest(original) : original),
  );
  return directory;
});

const enablePlugin = Effect.fn("enablePlugin")(function* (
  catalog: PluginCatalog.PluginCatalog["Service"],
  directory: string,
) {
  const { installation } = yield* catalog.add({ directory });
  yield* catalog.consent({
    installationId: installation.installationId,
    digest: installation.source!.digest,
  });
  return (yield* catalog.enable({ installationId: installation.installationId })).installation;
});

const awaitActions = (
  actions: PluginActions.PluginActions,
  predicate: (snapshot: PluginActionsSnapshot) => boolean,
) =>
  actions.subscribe.pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map((snapshot) => Option.getOrThrow(snapshot).actions),
  );

const awaitHostState = (
  catalog: PluginCatalog.PluginCatalog["Service"],
  installationId: PluginInstallationId,
  tags: ReadonlyArray<string>,
) =>
  catalog.subscribe.pipe(
    Stream.filter((snapshot) =>
      snapshot.installations.some(
        (installation) =>
          installation.installationId === installationId &&
          tags.includes(installation.hostState?._tag ?? ""),
      ),
    ),
    Stream.runHead,
  );

const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqlitePersistenceMemory));

it.layer(NodeServices.layer)("PluginActions", (it) => {
  it.effect(
    "lists an enabled plugin's actions without starting it, and drops them on disable",
    () =>
      withDatabase(
        Effect.gen(function* () {
          const { catalog, actions } = yield* startActions(yield* Scope.Scope);
          const directory = yield* preparePlugin();
          const installation = yield* enablePlugin(catalog, directory);
          const { installationId } = installation;

          const listed = yield* awaitActions(actions, (snapshot) => snapshot.actions.length > 0);
          expect(listed.map((action) => [action.name, action.target, action.placements])).toEqual([
            ["echo-target", "thread", ["command-palette", "thread-menu", "composer-slash"]],
            ["say-hello", "environment", ["command-palette"]],
            ["fail", "environment", ["command-palette"]],
            ["wait", "environment", ["command-palette"]],
          ]);
          expect(listed[0]).toMatchObject({
            pluginId: "test.actions",
            pluginName: "Actions fixture",
            title: "Echo target",
            description: "Says which thread it ran on.",
          });
          // Listing read the manifest only: no process was started.
          const [row] = (yield* catalog.list).installations;
          expect(row?.hostState).toEqual({ _tag: "idle" });

          const hello = listed.find((action) => action.name === "say-hello")!;
          expect(
            yield* actions.invoke({ actionId: hello.id, target: { _tag: "environment" } }),
          ).toEqual({ message: "Hello from test.actions" });

          yield* catalog.disable({ installationId });
          expect(yield* awaitActions(actions, () => true)).toEqual([]);
          const disabled = yield* actions
            .invoke({ actionId: hello.id, target: { _tag: "environment" } })
            .pipe(Effect.flip);
          expect(disabled.reason).toBe("not-found");

          // Enabled again: new ids, and the old one can never reach the new registration.
          yield* catalog.enable({ installationId });
          const relisted = yield* awaitActions(actions, (snapshot) => snapshot.actions.length > 0);
          expect(relisted.find((action) => action.name === "say-hello")!.id).not.toBe(hello.id);
          const stale = yield* actions
            .invoke({ actionId: hello.id, target: { _tag: "environment" } })
            .pipe(Effect.flip);
          expect(stale.reason).toBe("stale");

          yield* catalog.remove({ installationId });
          expect(yield* awaitActions(actions, () => true)).toEqual([]);
        }),
      ),
  );

  it.effect("runs an action on its resolved target and reports typed failures", () =>
    withDatabase(
      Effect.gen(function* () {
        const { catalog, actions } = yield* startActions(yield* Scope.Scope);
        const { installationId } = yield* enablePlugin(catalog, yield* preparePlugin());
        const listed = yield* awaitActions(actions, (snapshot) => snapshot.actions.length > 0);
        const byName = (name: string) => listed.find((action) => action.name === name)!.id;

        expect(
          yield* actions.invoke({
            actionId: byName("echo-target"),
            target: { _tag: "thread", threadId: THREAD },
          }),
        ).toEqual({ message: "thread thread-1 in /work/project" });

        const failures = yield* Effect.forEach(
          [
            { actionId: byName("echo-target"), target: { _tag: "environment" as const } },
            {
              actionId: byName("echo-target"),
              target: { _tag: "thread" as const, threadId: ThreadId.make("elsewhere") },
            },
            { actionId: byName("fail"), target: { _tag: "environment" as const } },
            {
              actionId: PluginActionId.make(`${installationId}:1:missing`),
              target: { _tag: "environment" as const },
            },
            {
              actionId: PluginActionId.make("not-an-action"),
              target: { _tag: "environment" as const },
            },
          ],
          (input) => actions.invoke(input).pipe(Effect.flip),
        );
        expect(failures.map((error) => [error.reason, error.message])).toEqual([
          ["target-mismatch", "Echo target runs on a thread."],
          ["target-not-found", "That thread does not exist here."],
          ["failed", "The fixture failed on purpose."],
          ["not-found", "That action is not available now."],
          ["not-found", "That action is not available here."],
        ]);

        // A disable while the action runs revokes it at once.
        const running = yield* actions
          .invoke({ actionId: byName("wait"), target: { _tag: "environment" } })
          .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
        yield* awaitHostState(catalog, installationId, ["starting", "running"]);
        yield* catalog.disable({ installationId });
        expect((yield* Fiber.join(running)).reason).toBe("stopped");
      }),
    ),
  );

  it.effect("refuses declarations the host cannot honour", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.forEach(
        [
          (manifest: Record<string, unknown>) => ({ ...manifest, capabilities: [] }),
          (manifest: Record<string, unknown>) => ({ ...manifest, proposedApi: false }),
          (manifest: Record<string, unknown>) => ({
            ...manifest,
            actions: [
              { name: "same", title: "One", target: "environment", placements: ["thread-menu"] },
              { name: "same", title: "Two", target: "environment", placements: ["thread-menu"] },
            ],
          }),
          (manifest: Record<string, unknown>) => ({
            ...manifest,
            actions: [
              {
                name: "twice",
                title: "Twice",
                target: "environment",
                placements: ["thread-menu", "thread-menu"],
              },
            ],
          }),
        ],
        (variant) =>
          preparePlugin(variant).pipe(
            Effect.flatMap(loadPluginDirectory),
            Effect.flip,
            Effect.map((error) => error.reason),
          ),
      );
      expect(reasons).toEqual([
        "it declares actions without the actions capability.",
        "it declares actions, which need proposedApi: true.",
        "it declares the action same twice.",
        "the action twice repeats a placement.",
      ]);
    }),
  );
});

describe("pluginActionsFromCatalog", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const installation: PluginInstallation = {
    installationId: PluginInstallationId.make("installation-1"),
    generation: 3,
    directory: "/srv/plugins/actions",
    manifest: {
      id: PluginId.make("test.actions"),
      name: "Actions",
      version: "1.0.0",
      capabilities: ["actions"],
      proposedApi: true,
      actions: [{ name: "go", title: "Go", target: "environment", placements: ["thread-menu"] }],
    },
    source: { digest, files: 2, bytes: 10 },
    problem: null,
    inspectedAt: "2026-10-04T00:00:00.000Z",
    consent: { digest, capabilities: ["actions"], grantedAt: "2026-10-04T00:00:00.000Z" },
    enabled: true,
    hostState: { _tag: "running" },
    addedAt: "2026-10-04T00:00:00.000Z",
  };
  const names = (installations: ReadonlyArray<PluginInstallation>) =>
    PluginActions.pluginActionsFromCatalog({ installations }).actions.map((action) => action.id);

  it("offers only actions that can run now", () => {
    expect(names([installation])).toEqual(["installation-1:3:go"]);
    // A state this server version does not know is unknown, not a reason to hide the action.
    const { hostState: _hostState, ...unknownState } = installation;
    expect(names([unknownState])).toEqual(["installation-1:3:go"]);
    for (const hidden of [
      { ...installation, enabled: false },
      { ...installation, consent: null },
      { ...installation, source: null, problem: "gone" },
      { ...installation, hostState: { _tag: "quarantined" as const, failures: 3, reason: "x" } },
      { ...installation, hostState: { _tag: "incompatible" as const, reason: "x" } },
      { ...installation, manifest: { ...installation.manifest!, capabilities: [] } },
    ]) {
      expect(names([hidden])).toEqual([]);
    }
  });
});
