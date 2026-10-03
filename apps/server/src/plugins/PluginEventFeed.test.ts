import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  PluginCatalogError,
  type PluginInstallationId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PluginCatalog from "./PluginCatalog.ts";
import * as PluginEventDelivery from "./PluginEventDelivery.ts";
import * as PluginEventFeed from "./PluginEventFeed.ts";
import * as PluginSupervisor from "./PluginSupervisor.ts";

// Children run the real CLI entry, which routes `__plugin-host` to the child runtime.
const BIN_PATH = `${import.meta.dirname}/../bin.ts`;

const environmentId = EnvironmentId.make("environment:plugin-events");
const threadId = ThreadId.make("thread:plugin-events");
const projectId = ProjectId.make("project:plugin-events");
const providerInstanceId = ProviderInstanceId.make("codex");

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

type Receipts = PubSub.Subscription<PluginEventFeed.PluginEventFeedReceipt>;

type Catalog = PluginCatalog.PluginCatalog["Service"];

/** A catalogue whose snapshots the feed sees only once `observed` completes. */
const observedAfter =
  (observed: Deferred.Deferred<void>) =>
  (catalog: Catalog): Catalog => ({
    ...catalog,
    subscribe: Stream.unwrap(Deferred.await(observed).pipe(Effect.as(catalog.subscribe))),
  });

/**
 * Starts a supervisor, catalogue and event feed in `scope`, as one server start
 * would. `feedCatalog` changes the catalogue the feed sees.
 */
const startServer = Effect.fn("startServer")(function* (
  scope: Scope.Scope,
  options: Partial<PluginEventFeed.PluginEventFeedOptions> = {},
  feedCatalog: (catalog: Catalog) => Catalog = (catalog) => catalog,
) {
  const delivery = yield* PluginEventDelivery.make;
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
    Effect.provideService(PluginEventDelivery.PluginEventDelivery, delivery),
    Effect.provideService(Scope.Scope, scope),
  );
  const feed = yield* PluginEventFeed.make(options).pipe(
    Effect.provideService(PluginCatalog.PluginCatalog, feedCatalog(catalog)),
    Effect.provideService(PluginEventDelivery.PluginEventDelivery, delivery),
    Effect.provideService(
      ServerEnvironment,
      ServerEnvironment.of({
        getEnvironmentId: Effect.succeed(environmentId),
        getDescriptor: Effect.die("unused"),
      }),
    ),
    Effect.provideService(Scope.Scope, scope),
  );
  const receipts: Receipts = yield* feed.subscribe.pipe(Effect.provideService(Scope.Scope, scope));
  return { catalog, feed, receipts };
});

/**
 * Writes a plugin that appends each event it handles to `events.log` next to
 * its directory, and fails every event while a `fail` file exists there.
 */
const preparePlugin = Effect.fn("preparePlugin")(function* (id: string, onEvent = true) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-events-" });
  const directory = path.join(root, "plugin");
  yield* fs.makeDirectory(directory);
  const log = path.join(root, "events.log");
  const fail = path.join(root, "fail");
  yield* fs.writeFileString(
    path.join(directory, "main.mjs"),
    [
      `import * as NodeFS from "node:fs";`,
      `export function activate(context) {`,
      `  if (!${onEvent}) return;`,
      `  context.proposed.onEvent((event) => {`,
      `    if (NodeFS.existsSync(${toJson(fail)})) throw new Error("told to fail");`,
      `    NodeFS.appendFileSync(${toJson(log)}, JSON.stringify(event) + "\\n");`,
      `  });`,
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
      capabilities: ["events"],
      proposedApi: true,
    }),
  );
  const handled = fs.exists(log).pipe(
    Effect.flatMap((exists) => (exists ? fs.readFileString(log) : Effect.succeed(""))),
    Effect.map((content) =>
      content
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    ),
  );
  return {
    directory,
    handled,
    failing: (on: boolean) => (on ? fs.writeFileString(fail, "") : fs.remove(fail)),
  };
});

const install = Effect.fn("install")(function* (catalog: Catalog, directory: string) {
  const { installation } = yield* catalog.add({ directory });
  const installationId = installation.installationId;
  yield* catalog.consent({ installationId, digest: installation.source!.digest });
  yield* catalog.enable({ installationId });
  return installationId;
});

/** Takes receipts until one matches; earlier ones are dropped. */
const next = <Tag extends PluginEventFeed.PluginEventFeedReceipt["_tag"]>(
  receipts: Receipts,
  tag: Tag,
  installationId: PluginInstallationId,
) =>
  Effect.gen(function* () {
    while (true) {
      const receipt = yield* PubSub.take(receipts);
      if (receipt._tag === tag && receipt.installationId === installationId)
        return receipt as Extract<PluginEventFeed.PluginEventFeedReceipt, { _tag: Tag }>;
    }
  });

const seedThread = Effect.gen(function* () {
  const eventSink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  yield* eventSink.write({
    events: [
      {
        id: EventId.make("event:plugin-events:thread"),
        type: "thread.created",
        threadId,
        providerInstanceId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId,
          title: "Fix the login bug",
          providerInstanceId,
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      },
    ],
  });
});

/** Records a run's finalization the way RunFinalizationService does; returns its sequence. */
const finalizeRun = (name: string, failedAt?: "refresh-workspace") =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const runId = RunId.make(`run:${name}`);
    const envelope = {
      id: EventId.make(`event:run-finalized:${runId}`),
      threadId,
      runId,
      providerInstanceId,
      occurredAt: yield* DateTime.now,
    };
    const [stored] = yield* eventSink.write({
      events: [
        failedAt === undefined
          ? {
              ...envelope,
              type: "run.finalized",
              payload: { runId, outcome: "completed", checkpointId: null },
            }
          : {
              ...envelope,
              type: "run.finalization-failed",
              payload: { runId, operation: failedAt },
            },
      ],
    });
    return stored!.sequence;
  });

const storedCursor = (installationId: PluginInstallationId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly acknowledged_sequence: number }>`
      SELECT acknowledged_sequence FROM plugin_event_cursors
      WHERE installation_id = ${installationId}
    `;
    return rows[0]?.acknowledged_sequence;
  });

// One database, event store and projection per test; "restarts" replace the plugin side.
const withStores = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  );
  return effect.pipe(Effect.provide(EventSink.layer.pipe(Layer.provideMerge(stores))));
};

it.layer(NodeServices.layer)("PluginEventFeed", (it) => {
  describe("delivery", () => {
    it.effect("delivers finished turns once, in order, and keeps the cursor across a restart", () =>
      withStores(
        Effect.gen(function* () {
          yield* seedThread;
          const plugin = yield* preparePlugin("test.turn-notifier");
          const first = yield* Scope.make();
          const server = yield* startServer(first, { pageSize: 2 });
          const installationId = yield* install(server.catalog, plugin.directory);
          // The first start begins at the end of the log: the thread's creation is not delivered.
          const started = yield* next(server.receipts, "Started", installationId);

          const sequences = yield* Effect.forEach(["a", "b", "c"], (name) => finalizeRun(name));
          const failedSequence = yield* finalizeRun("d", "refresh-workspace");
          let acknowledged = started.cursor;
          while (acknowledged < failedSequence) {
            const receipt = yield* next(server.receipts, "Acknowledged", installationId);
            // Pages hold at most two events.
            expect(receipt.delivered).toBeLessThanOrEqual(2);
            acknowledged = receipt.throughSequence;
          }
          const handled = yield* plugin.handled;
          expect(handled.map((event) => event.sequence)).toEqual([...sequences, failedSequence]);
          expect(handled[0]).toEqual({
            deliveryId: "event:run-finalized:run:a",
            sequence: sequences[0],
            occurredAt: expect.any(String),
            environmentId,
            threadId,
            runId: "run:a",
            thread: { projectId, title: "Fix the login bug" },
            type: "run.finalized",
            outcome: "completed",
          });
          expect(handled[3]).toMatchObject({
            deliveryId: "event:run-finalized:run:d",
            type: "run.finalization-failed",
            operation: "refresh-workspace",
          });
          expect(yield* storedCursor(installationId)).toBe(failedSequence);

          yield* Scope.close(first, Exit.void);
          const later = yield* finalizeRun("e");
          const restarted = yield* startServer(yield* Scope.Scope);
          const receipt = yield* next(restarted.receipts, "Acknowledged", installationId);
          expect(receipt).toMatchObject({ delivered: 1, throughSequence: later });
          // Nothing acknowledged before the restart arrives again.
          expect((yield* plugin.handled).map((event) => event.sequence)).toEqual([
            ...sequences,
            failedSequence,
            later,
          ]);
        }),
      ),
    );
  });

  describe("starting point", () => {
    it.effect(
      "delivers events committed after enable even when the feed sees the enable late",
      () =>
        withStores(
          Effect.gen(function* () {
            yield* seedThread;
            const plugin = yield* preparePlugin("test.late-observer");
            const observed = yield* Deferred.make<void>();
            const server = yield* startServer(yield* Scope.Scope, {}, observedAfter(observed));
            const installationId = yield* install(server.catalog, plugin.directory);
            const enabledAt = yield* storedCursor(installationId);
            const sequence = yield* finalizeRun("right-after-enable");
            expect(enabledAt).toBeLessThan(sequence);

            yield* Deferred.succeed(observed, undefined);
            expect(yield* next(server.receipts, "Started", installationId)).toMatchObject({
              cursor: enabledAt,
            });
            expect(yield* next(server.receipts, "Acknowledged", installationId)).toMatchObject({
              delivered: 1,
              throughSequence: sequence,
            });
            expect((yield* plugin.handled).map((event) => event.sequence)).toEqual([sequence]);
          }),
        ),
    );

    it.effect(
      "keeps the enable's starting point when the server stops before the feed saw it",
      () =>
        withStores(
          Effect.gen(function* () {
            yield* seedThread;
            const plugin = yield* preparePlugin("test.early-restart");
            const first = yield* Scope.make();
            const server = yield* startServer(
              first,
              {},
              observedAfter(yield* Deferred.make<void>()),
            );
            const installationId = yield* install(server.catalog, plugin.directory);
            const sequence = yield* finalizeRun("before-restart");
            yield* Scope.close(first, Exit.void);

            const restarted = yield* startServer(yield* Scope.Scope);
            expect(yield* next(restarted.receipts, "Acknowledged", installationId)).toMatchObject({
              delivered: 1,
              throughSequence: sequence,
            });
            expect((yield* plugin.handled).map((event) => event.sequence)).toEqual([sequence]);
          }),
        ),
    );
  });

  describe("handler failures", () => {
    it.effect("retries a failing page, quarantines it without moving the cursor, and resumes", () =>
      withStores(
        Effect.gen(function* () {
          yield* seedThread;
          const plugin = yield* preparePlugin("test.failing");
          const { catalog, feed, receipts } = yield* startServer(yield* Scope.Scope, {
            maxFailures: 2,
            retryBackoff: "1 second",
          });
          const installationId = yield* install(catalog, plugin.directory);
          const { cursor } = yield* next(receipts, "Started", installationId);

          yield* plugin.failing(true);
          const sequence = yield* finalizeRun("failing");
          const failed = yield* next(receipts, "Failed", installationId);
          expect(failed).toMatchObject({ cursor, failures: 1 });
          expect(failed.reason).toContain("told to fail");
          yield* TestClock.adjust("1 second");
          const quarantined = yield* next(receipts, "Quarantined", installationId);
          expect(quarantined).toMatchObject({ cursor, failures: 2 });
          expect(yield* storedCursor(installationId)).toBe(cursor);
          const status = Option.getOrThrow(yield* feed.status(installationId));
          expect(status).toMatchObject({ cursor, state: { _tag: "quarantined", failures: 2 } });

          // Quarantine waits for a person, even when the handler would succeed now.
          yield* plugin.failing(false);
          yield* TestClock.adjust("1 minute");
          expect((yield* feed.status(installationId)).pipe(Option.getOrThrow).state._tag).toBe(
            "quarantined",
          );
          expect(yield* plugin.handled).toEqual([]);

          yield* feed.resume(installationId);
          expect(yield* next(receipts, "Started", installationId)).toMatchObject({ cursor });
          expect(yield* next(receipts, "Acknowledged", installationId)).toMatchObject({
            delivered: 1,
            throughSequence: sequence,
          });
          expect((yield* plugin.handled).map((event) => event.sequence)).toEqual([sequence]);
        }),
      ),
    );
    it.effect("stops in front of an unreadable event and delivers it once repaired", () =>
      withStores(
        Effect.gen(function* () {
          yield* seedThread;
          const sql = yield* SqlClient.SqlClient;
          const plugin = yield* preparePlugin("test.unreadable");
          const observed = yield* Deferred.make<void>();
          const { catalog, feed, receipts } = yield* startServer(
            yield* Scope.Scope,
            {},
            observedAfter(observed),
          );
          const installationId = yield* install(catalog, plugin.directory);
          const [first, broken, last] = yield* Effect.forEach(["a", "b", "c"], (name) =>
            finalizeRun(name),
          );
          const [stored] = yield* sql<{ readonly payload_json: string }>`
            SELECT payload_json FROM orchestration_events WHERE sequence = ${broken}
          `;
          yield* sql`UPDATE orchestration_events SET payload_json = '{}' WHERE sequence = ${broken}`;
          yield* Deferred.succeed(observed, undefined);

          expect(yield* next(receipts, "Acknowledged", installationId)).toMatchObject({
            delivered: 1,
            throughSequence: broken! - 1,
          });
          const quarantined = yield* next(receipts, "Quarantined", installationId);
          expect(quarantined).toMatchObject({ cursor: broken! - 1, failures: 0 });
          expect(quarantined.reason).toContain(`sequence ${broken}`);
          expect(yield* storedCursor(installationId)).toBe(broken! - 1);
          expect((yield* plugin.handled).map((event) => event.sequence)).toEqual([first]);

          yield* sql`
            UPDATE orchestration_events SET payload_json = ${stored!.payload_json}
            WHERE sequence = ${broken}
          `;
          yield* feed.resume(installationId);
          expect(yield* next(receipts, "Acknowledged", installationId)).toMatchObject({
            delivered: 2,
            throughSequence: last,
          });
          expect((yield* plugin.handled).map((event) => event.sequence)).toEqual([
            first,
            broken,
            last,
          ]);
        }),
      ),
    );
    it.effect("retries after catalogue errors while still registered, without quarantine", () =>
      withStores(
        Effect.gen(function* () {
          yield* seedThread;
          const plugin = yield* preparePlugin("test.storage");
          // The first two calls fail outside the plugin, the way a failed catalogue save does.
          const refusals = ["storage", "unavailable"];
          const { catalog, feed, receipts } = yield* startServer(
            yield* Scope.Scope,
            { maxFailures: 1, retryBackoff: "1 second" },
            (catalog) => ({
              ...catalog,
              invoke: (installationId, handler, input, options) => {
                const reason = refusals.shift();
                return reason === undefined
                  ? catalog.invoke(installationId, handler, input, options)
                  : Effect.fail(new PluginCatalogError({ reason, message: `Refused: ${reason}.` }));
              },
            }),
          );
          const installationId = yield* install(catalog, plugin.directory);
          const { cursor, generation } = yield* next(receipts, "Started", installationId);
          const sequence = yield* finalizeRun("after-storage-trouble");

          expect(yield* next(receipts, "Retrying", installationId)).toMatchObject({
            cursor,
            generation,
            reason: "Refused: storage.",
          });
          expect(Option.getOrThrow(yield* feed.status(installationId)).state).toMatchObject({
            _tag: "retrying",
            failures: 1,
          });
          yield* TestClock.adjust("1 second");
          expect(yield* next(receipts, "Retrying", installationId)).toMatchObject({
            reason: "Refused: unavailable.",
          });
          yield* TestClock.adjust("2 seconds");
          expect(yield* next(receipts, "Acknowledged", installationId)).toMatchObject({
            generation,
            delivered: 1,
            throughSequence: sequence,
          });
          expect((yield* plugin.handled).map((event) => event.sequence)).toEqual([sequence]);
        }),
      ),
    );
  });

  describe("plugin contract", () => {
    it.effect("fails delivery to a plugin that registered no onEvent handler", () =>
      withStores(
        Effect.gen(function* () {
          yield* seedThread;
          const plugin = yield* preparePlugin("test.no-handler", false);
          const { catalog, receipts } = yield* startServer(yield* Scope.Scope);
          const installationId = yield* install(catalog, plugin.directory);
          const { cursor } = yield* next(receipts, "Started", installationId);
          yield* finalizeRun("unhandled");
          const failed = yield* next(receipts, "Failed", installationId);
          expect(failed).toMatchObject({ cursor, failures: 1 });
          expect(failed.reason).toContain("registered no onEvent handler");
        }),
      ),
    );
  });

  describe("reverse states", () => {
    it.effect("stops on disable, resumes from the cursor on enable, and forgets it on remove", () =>
      withStores(
        Effect.gen(function* () {
          yield* seedThread;
          const plugin = yield* preparePlugin("test.reverse");
          const { catalog, feed, receipts } = yield* startServer(yield* Scope.Scope);
          const installationId = yield* install(catalog, plugin.directory);
          const { cursor } = yield* next(receipts, "Started", installationId);

          yield* catalog.disable({ installationId });
          const missed = yield* finalizeRun("while-disabled");
          expect(yield* feed.status(installationId)).toEqual(Option.none());
          expect(yield* plugin.handled).toEqual([]);

          yield* catalog.enable({ installationId });
          expect(yield* next(receipts, "Started", installationId)).toMatchObject({
            cursor,
            generation: 2,
          });
          expect(yield* next(receipts, "Acknowledged", installationId)).toMatchObject({
            delivered: 1,
            throughSequence: missed,
          });

          yield* catalog.remove({ installationId });
          yield* next(receipts, "Forgotten", installationId);
          expect(yield* storedCursor(installationId)).toBeUndefined();
          expect(yield* feed.status(installationId)).toEqual(Option.none());
        }),
      ),
    );
  });
});
