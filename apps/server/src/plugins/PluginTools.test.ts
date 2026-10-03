import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type PluginToolError } from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PluginCatalog from "./PluginCatalog.ts";
import * as PluginSupervisor from "./PluginSupervisor.ts";
import * as PluginTools from "./PluginTools.ts";

// Children run the real CLI entry, which routes `__plugin-host` to the child runtime.
const BIN_PATH = `${import.meta.dirname}/../bin.ts`;
const FIXTURE = `${import.meta.dirname}/testFixtures/toolsPlugin`;

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const context = {
  environmentId: EnvironmentId.make("environment-tools"),
  threadId: ThreadId.make("thread-tools"),
};

/** A real supervisor, catalogue, and tool service in `scope`, as one server start would run them. */
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
  const tools = yield* PluginTools.make.pipe(
    Effect.provideService(PluginCatalog.PluginCatalog, catalog),
  );
  /** Adds, approves, and enables a plugin directory. */
  const install = Effect.fn("install")(function* (directory: string) {
    const { installation } = yield* catalog.add({ directory });
    const installationId = installation.installationId;
    yield* catalog.consent({ installationId, digest: installation.source!.digest });
    return (yield* catalog.enable({ installationId })).installation;
  });
  return { supervisor, catalog, tools, install };
});

/** A scoped copy of the committed fixture, so tests never share a plugin directory. */
const copyFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(
    yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-tools-" }),
    "plugin",
  );
  yield* fs.copy(FIXTURE, directory);
  return directory;
});

/** A scoped plugin whose describe handler answers `description`. */
const describingPlugin = Effect.fn("describingPlugin")(function* (
  id: string,
  description: unknown,
  capabilities: ReadonlyArray<string> = ["tools"],
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(
    yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-tools-" }),
    "plugin",
  );
  yield* fs.makeDirectory(directory);
  yield* fs.writeFileString(
    path.join(directory, "main.mjs"),
    [
      `export function activate(context) {`,
      `  context.proposed.handle("t3.tools.describe", () => (${toJson(description)}));`,
      `  context.proposed.handle("t3.tool.ping", () => "pong");`,
      `}`,
      ``,
    ].join("\n"),
  );
  yield* fs.writeFileString(
    path.join(directory, "t3-plugin.json"),
    toJson({
      id,
      name: id,
      version: "1.0.0",
      apiVersion: 1,
      entry: "main.mjs",
      capabilities,
      proposedApi: true,
    }),
  );
  return directory;
});

const ping = (description: string) => ({
  name: "ping",
  description,
  inputSchema: { type: "object", properties: {} },
  sideEffect: "read",
});

const reasonOf = (error: PluginToolError) => error.reason;

const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqlitePersistenceMemory));

it.layer(NodeServices.layer)("PluginTools", (it) => {
  describe("granted plugins", () => {
    it.effect("lists host-derived schemas and calls tools with the session's context", () =>
      withDatabase(
        Effect.gen(function* () {
          const { tools, install } = yield* start(yield* Scope.Scope);
          const installation = yield* install(yield* copyFixture);
          const grants = yield* tools.grants;
          expect(grants).toEqual([{ installationId: installation.installationId, generation: 1 }]);

          const listed = yield* tools.list(grants);
          expect(listed.tools.map((tool) => tool.tool)).toEqual([
            "test.tools/word_count",
            "test.tools/echo_context",
            "test.tools/wait_for_cancel",
            "test.tools/big_result",
          ]);
          expect(listed.tools[0]).toMatchObject({
            tool: "test.tools/word_count",
            plugin: { id: "test.tools", name: "Tools fixture" },
            title: "Count words",
            description: "Count the words in a text.",
            // Derived from the declared schema, so its rendering is Effect's, not the plugin's.
            inputSchema: {
              type: "object",
              properties: { text: { type: "string", maxLength: 10000 } },
              required: ["text"],
            },
            sideEffect: "read",
            openWorld: false,
          });
          expect(listed.tools[2]).toMatchObject({ sideEffect: "write", openWorld: true });
          expect(listed).toMatchObject({ unavailable: [], omitted: [], notInThisSession: [] });

          const call = (tool: string, input: unknown) =>
            tools.call(grants, { tool, input, context });
          expect(yield* call("test.tools/word_count", { text: "one two  three" })).toEqual({
            words: 3,
          });
          // The context comes from the session, never from the input.
          expect(yield* call("test.tools/echo_context", {})).toEqual({ input: {}, context });

          const failures = yield* Effect.forEach(
            [
              ["test.tools/word_count", { text: 5 }],
              ["test.tools/word_count", {}],
              ["test.tools/word_count", { text: "x".repeat(10_001) }],
              ["test.tools/echo_context", { context: { threadId: "other" } }],
              ["test.tools/nope", {}],
              ["word_count", {}],
              ["test.tools/big_result", { length: 70_000 }],
            ] as const,
            ([tool, input]) => call(tool, input).pipe(Effect.flip, Effect.map(reasonOf)),
          );
          expect(failures).toEqual([
            "invalid-input",
            "invalid-input",
            "invalid-input",
            "invalid-input",
            "unknown-tool",
            "unknown-tool",
            "result-too-large",
          ]);
        }),
      ),
    );

    it.effect("refuses a disabled plugin at once, also mid-call, and its next registration", () =>
      withDatabase(
        Effect.gen(function* () {
          const { supervisor, catalog, tools, install } = yield* start(yield* Scope.Scope);
          const installation = yield* install(yield* copyFixture);
          const installationId = installation.installationId;
          const grants = yield* tools.grants;
          const events = yield* supervisor.subscribe;

          const waiting = yield* tools
            .call(grants, { tool: "test.tools/wait_for_cancel", input: {}, context })
            .pipe(Effect.flip, Effect.forkChild);
          yield* Stream.fromSubscription(events).pipe(
            Stream.filter((event) => event._tag === "Log" && event.message === "wait-started"),
            Stream.runHead,
          );
          yield* catalog.disable({ installationId });
          const revoked = yield* Fiber.join(waiting);
          expect(revoked.reason).toBe("unavailable");

          expect(yield* tools.list(grants)).toEqual({
            tools: [],
            unavailable: [],
            omitted: [],
            notInThisSession: [],
          });
          const disabled = yield* tools
            .call(grants, { tool: "test.tools/word_count", input: { text: "a" }, context })
            .pipe(Effect.flip);
          expect(disabled.reason).toBe("unavailable");

          // A re-enable is a new registration: the old session's grant does not reach it.
          yield* catalog.enable({ installationId });
          const stale = yield* tools.list(grants);
          expect(stale.tools).toEqual([]);
          expect(stale.notInThisSession).toEqual([{ id: "test.tools", name: "Tools fixture" }]);
          const notGranted = yield* tools
            .call(grants, { tool: "test.tools/word_count", input: { text: "a" }, context })
            .pipe(Effect.flip);
          expect(notGranted.reason).toBe("not-granted");
          const fresh = yield* tools.grants;
          expect(fresh).toEqual([{ installationId, generation: 2 }]);
          expect(
            yield* tools.call(fresh, {
              tool: "test.tools/word_count",
              input: { text: "a b" },
              context,
            }),
          ).toEqual({ words: 2 });
        }),
      ),
    );
  });

  describe("descriptions", () => {
    it.effect("reports plugins the host cannot describe and starts no plugin without tools", () =>
      withDatabase(
        Effect.gen(function* () {
          const { catalog, tools, install } = yield* start(yield* Scope.Scope);
          yield* install(yield* copyFixture);
          yield* install(
            yield* describingPlugin("test.pattern", {
              tools: [
                {
                  ...ping("Uses a pattern."),
                  inputSchema: {
                    type: "object",
                    properties: { id: { type: "string", pattern: "^(a+)+$" } },
                  },
                },
              ],
            }),
          );
          yield* install(
            yield* describingPlugin("test.duplicate", { tools: [ping("One."), ping("Two.")] }),
          );
          yield* install(
            yield* describingPlugin("test.scalar", {
              tools: [{ ...ping("Takes a string."), inputSchema: { type: "string" } }],
            }),
          );
          const quiet = yield* install(
            yield* describingPlugin("test.quiet", { tools: [ping("Never asked.")] }, []),
          );

          const grants = yield* tools.grants;
          expect(grants).toHaveLength(4);
          const listed = yield* tools.list(grants);
          expect(listed.tools.map((tool) => tool.plugin.id)).toEqual(
            Array.from({ length: 4 }, () => "test.tools"),
          );
          const reasons = Object.fromEntries(
            listed.unavailable.map(({ plugin, reason }) => [plugin.id, reason]),
          );
          expect(Object.keys(reasons).toSorted()).toEqual([
            "test.duplicate",
            "test.pattern",
            "test.scalar",
          ]);
          expect(reasons["test.pattern"]).toContain("Patterns may block validation");
          expect(reasons["test.duplicate"]).toBe("It declares ping twice.");
          expect(reasons["test.scalar"]).toContain("must describe an object");

          const rows = (yield* catalog.list).installations;
          const quietRow = rows.find((row) => row.installationId === quiet.installationId);
          expect(quietRow?.hostState).toEqual({ _tag: "idle" });
        }),
      ),
    );

    it.effect("keeps the full list small and lists a large plugin on its own", () =>
      withDatabase(
        Effect.gen(function* () {
          const { tools, install } = yield* start(yield* Scope.Scope);
          const large = (id: string) =>
            describingPlugin(id, {
              tools: Array.from({ length: 20 }, (_, index) => ({
                ...ping("d".repeat(1_900)),
                name: `tool_${index}`,
              })),
            });
          yield* install(yield* large("test.large-a"));
          yield* install(yield* large("test.large-b"));
          const grants = yield* tools.grants;

          // Either fits alone; together they pass the list budget, so one is left out whole.
          const all = yield* tools.list(grants);
          const listedIds = new Set(all.tools.map((tool) => tool.plugin.id));
          expect(listedIds.size).toBe(1);
          expect(all.tools).toHaveLength(20);
          expect(all.omitted).toHaveLength(1);
          const omitted = all.omitted[0]!;
          expect(omitted.tools).toBe(20);
          expect(listedIds.has(omitted.plugin.id)).toBe(false);
          const one = yield* tools.list(grants, { plugin: omitted.plugin.id });
          expect(one.tools).toHaveLength(20);
          expect(one.omitted).toEqual([]);
        }),
      ),
    );
  });
});
