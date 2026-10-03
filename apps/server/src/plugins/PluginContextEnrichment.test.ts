import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PluginCatalog from "./PluginCatalog.ts";
import * as PluginContextEnrichment from "./PluginContextEnrichment.ts";
import * as PluginSupervisor from "./PluginSupervisor.ts";

// Children run the real CLI entry, which routes `__plugin-host` to the child runtime.
const BIN_PATH = `${import.meta.dirname}/../bin.ts`;
const FIXTURE = `${import.meta.dirname}/testFixtures/contextPlugin`;

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const fromJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const environmentId = EnvironmentId.make("environment-context");

const runInput = (text: string) => ({
  projectId: ProjectId.make("project-context"),
  threadId: ThreadId.make("thread-context"),
  runId: RunId.make("run-context"),
  cwd: "/work/context",
  message: { text, truncated: false },
});

/** A real supervisor, catalogue, and enricher in `scope`, as one server start would run them. */
const start = Effect.fn("start")(function* (scope: Scope.Scope) {
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
  const enricher = yield* PluginContextEnrichment.make.pipe(
    Effect.provideService(PluginCatalog.PluginCatalog, catalog),
    Effect.provideService(
      ServerEnvironment,
      ServerEnvironment.of({ getEnvironmentId: Effect.succeed(environmentId) } as never),
    ),
  );
  /** Adds, approves, and enables a plugin directory. */
  const install = Effect.fn("install")(function* (directory: string) {
    const { installation } = yield* catalog.add({ directory });
    const installationId = installation.installationId;
    yield* catalog.consent({ installationId, digest: installation.source!.digest });
    return (yield* catalog.enable({ installationId })).installation;
  });
  return { supervisor, catalog, enricher, install };
});

/** A scoped plugin directory: the committed fixture, or that fixture with a changed manifest. */
const pluginDirectory = Effect.fn("pluginDirectory")(function* (
  manifest?: (fixture: Record<string, unknown>) => Record<string, unknown>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(
    yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-context-" }),
    "plugin",
  );
  yield* fs.copy(FIXTURE, directory);
  if (manifest !== undefined) {
    const file = path.join(directory, "t3-plugin.json");
    const fixture = fromJson(yield* fs.readFileString(file)) as Record<string, unknown>;
    yield* fs.writeFileString(file, toJson(manifest(fixture)));
  }
  return directory;
});

const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqlitePersistenceMemory));

it.layer(NodeServices.layer)("PluginContextEnrichment", (it) => {
  describe("sources", () => {
    it.effect("lists only enabled plugins whose consent covers a declared enrich transform", () =>
      withDatabase(
        Effect.gen(function* () {
          const { catalog, enricher, install } = yield* start(yield* Scope.Scope);
          expect(yield* enricher.sources).toEqual([]);

          const pending = yield* catalog.add({ directory: yield* pluginDirectory() });
          // Added but not consented or enabled: never called.
          expect(yield* enricher.sources).toEqual([]);
          yield* catalog.remove({ installationId: pending.installation.installationId });

          const installation = yield* install(yield* pluginDirectory());
          // The capability alone is harmless: without the declaration nothing is called.
          yield* install(
            yield* pluginDirectory(({ transforms: _transforms, ...fixture }) => ({
              ...fixture,
              id: "test.capability-only",
            })),
          );
          expect(yield* enricher.sources).toEqual([
            {
              installationId: installation.installationId,
              generation: installation.generation,
              pluginId: "test.context",
              name: "Context fixture",
              timeoutSeconds: 2,
            },
          ]);

          yield* catalog.disable({ installationId: installation.installationId });
          expect(yield* enricher.sources).toEqual([]);
        }),
      ),
    );

    it.effect("refuses a manifest that declares transforms without what they need", () =>
      withDatabase(
        Effect.gen(function* () {
          const { catalog } = yield* start(yield* Scope.Scope);
          const refused = (change: (fixture: Record<string, unknown>) => Record<string, unknown>) =>
            pluginDirectory(change).pipe(
              Effect.flatMap((directory) => catalog.add({ directory })),
              Effect.flip,
              Effect.map((error) => error.message),
            );
          expect(yield* refused((fixture) => ({ ...fixture, capabilities: [] }))).toContain(
            "it declares transforms without the transforms capability.",
          );
          expect(yield* refused((fixture) => ({ ...fixture, proposedApi: false }))).toContain(
            "it declares transforms, which need proposedApi: true.",
          );
          expect(
            yield* refused((fixture) => ({
              ...fixture,
              transforms: { enrich: { timeoutSeconds: 11 } },
            })),
          ).toContain("t3-plugin.json is invalid");
        }),
      ),
    );
  });

  describe("enrich", () => {
    it.effect("passes the run to the plugin and returns its context", () =>
      withDatabase(
        Effect.gen(function* () {
          const { enricher, install } = yield* start(yield* Scope.Scope);
          yield* install(yield* pluginDirectory());
          const [source] = yield* enricher.sources;

          expect(yield* enricher.enrich(source!, runInput("Which codename?"))).toEqual({
            _tag: "added",
            context: [
              { title: "Project codename", text: "The project codename is PERIWINKLE-42." },
            ],
          });
          const echoed = yield* enricher.enrich(source!, runInput("[echo]"));
          expect(echoed._tag).toBe("added");
          expect(fromJson(echoed._tag === "added" ? echoed.context[0]!.text : "null")).toEqual({
            environmentId,
            ...runInput("[echo]"),
          });
          expect(yield* enricher.enrich(source!, runInput("[none]"))).toEqual({
            _tag: "added",
            context: [],
          });
        }),
      ),
    );

    it.effect("fails open on an error or an answer outside the bounds", () =>
      withDatabase(
        Effect.gen(function* () {
          const { enricher, install } = yield* start(yield* Scope.Scope);
          yield* install(yield* pluginDirectory());
          const [source] = yield* enricher.sources;
          const reasonOf = (text: string) =>
            enricher
              .enrich(source!, runInput(text))
              .pipe(Effect.map((outcome) => (outcome._tag === "skipped" ? outcome.reason : "")));

          expect(yield* reasonOf("[fail]")).toContain("the notes index is offline");
          expect(yield* reasonOf("[bad]")).toContain(
            "Context fixture answered with context outside the allowed shape",
          );
          expect(yield* reasonOf("[big]")).toBe(
            "Context fixture answered with more than 16 KiB of context.",
          );
          // The plugin keeps answering after each refusal.
          expect((yield* enricher.enrich(source!, runInput("ok")))._tag).toBe("added");
        }),
      ),
    );

    it.effect("gives up at the declared deadline and when the plugin is disabled mid-call", () =>
      withDatabase(
        Effect.gen(function* () {
          const { supervisor, catalog, enricher, install } = yield* start(yield* Scope.Scope);
          const installation = yield* install(yield* pluginDirectory());
          const [source] = yield* enricher.sources;
          const events = yield* supervisor.subscribe;
          const waitStarted = Stream.fromSubscription(events).pipe(
            Stream.filter((event) => event._tag === "Log" && event.message === "wait-started"),
            Stream.runHead,
          );

          const slow = yield* enricher
            .enrich(source!, runInput("[wait]"))
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* waitStarted;
          yield* TestClock.adjust("2 seconds");
          expect(yield* Fiber.join(slow)).toEqual({
            _tag: "skipped",
            reason: "Context fixture did not answer within 2 seconds.",
          });

          const revoked = yield* enricher
            .enrich(source!, runInput("[wait]"))
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* waitStarted;
          yield* catalog.disable({ installationId: installation.installationId });
          expect(yield* Fiber.join(revoked)).toEqual({
            _tag: "skipped",
            reason: "Plugin test.context was stopped before the call finished.",
          });
          // Later runs do not call it at all.
          expect(yield* enricher.sources).toEqual([]);
          // A call pinned to the revoked registration is refused before it reaches a process.
          yield* catalog.enable({ installationId: installation.installationId });
          expect(yield* enricher.enrich(source!, runInput("ok"))).toEqual({
            _tag: "skipped",
            reason: "The plugin was enabled again since this call was prepared.",
          });
        }),
      ),
    );
  });
});
