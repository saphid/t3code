import { describe, expect, it } from "@effect/vitest";
import {
  NodeId,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import type * as EventSink from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import {
  isPluginContextItem,
  prepareRunContext,
  type RunContextEnricherV2Shape,
  type RunContextOutcome,
  type RunContextSource,
  withPluginContext,
} from "./RunContextEnrichment.ts";

const threadId = ThreadId.make("thread-run-context");
const runId = RunId.make("run-run-context");
const attemptId = RunAttemptId.make("attempt-run-context");

const source = (index: number): RunContextSource => ({
  installationId: `installation-${index}`,
  generation: 1,
  pluginId: `test.p${index}`,
  name: `Plugin ${index}`,
  timeoutSeconds: 5,
});

const added = (text: string): RunContextOutcome => ({
  _tag: "added",
  context: [{ title: "Notes", text }],
});

/**
 * An in-memory run and its timeline. `writeIfRunCurrent` commits only while
 * the run is still this attempt's `starting` run, like the real sink.
 */
const makeStore = () => {
  const items = new Map<string, OrchestrationV2TurnItem>();
  const run = { status: "starting" as string };
  const writes: Array<ReadonlyArray<OrchestrationV2TurnItem>> = [];
  const eventSink = {
    writeIfRunCurrent: (input: Parameters<EventSink.EventSinkV2Shape["writeIfRunCurrent"]>[0]) =>
      Effect.sync(() => {
        const committed =
          run.status === input.expectedStatus && input.activeAttemptId === attemptId;
        if (committed) {
          const payloads = input.events.flatMap((event) =>
            event.type === "turn-item.updated" ? [event.payload] : [],
          );
          for (const item of payloads) items.set(item.id, item);
          writes.push(payloads);
        }
        return { committed, storedEvents: [] };
      }),
  } as unknown as EventSink.EventSinkV2Shape;
  return { items, run, writes, eventSink };
};

const enricherOf = (
  sources: ReadonlyArray<RunContextSource>,
  enrich: RunContextEnricherV2Shape["enrich"],
) => {
  const calls: Array<string> = [];
  const enricher: RunContextEnricherV2Shape = {
    sources: Effect.succeed(sources),
    enrich: (called, input) =>
      Effect.suspend(() => {
        calls.push(called.pluginId);
        return enrich(called, input);
      }),
  };
  return { enricher, calls };
};

const prepare = Effect.fn("prepare")(function* (
  store: ReturnType<typeof makeStore>,
  enricher: RunContextEnricherV2Shape,
) {
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  return yield* prepareRunContext({
    enricher,
    eventSink: store.eventSink,
    idAllocator,
    threadId,
    projectId: ProjectId.make("project-run-context"),
    runId,
    attemptId,
    rootNodeId: NodeId.make("node-run-context"),
    providerThreadId: ProviderThreadId.make("provider-thread-run-context"),
    providerInstanceId: ProviderInstanceId.make("claude-run-context"),
    turnItems: [...store.items.values()],
    userText: "What is the codename?",
    cwd: "/work/run-context",
  });
});

const contextItems = (store: ReturnType<typeof makeStore>) =>
  [...store.items.values()].filter(isPluginContextItem);

describe("prepareRunContext", () => {
  it.effect("saves the call before it runs, then the answer, and reuses both on every retry", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const first = enricherOf([source(1)], (_source, input) =>
        Effect.sync(() => {
          // The record that enrichment began is durable before plugin code runs.
          expect(contextItems(store).map((item) => item.status)).toEqual(["running"]);
          expect(input).toEqual({
            projectId: "project-run-context",
            threadId,
            runId,
            cwd: "/work/run-context",
            message: { text: "What is the codename?", truncated: false },
          });
          return added("The codename is PERIWINKLE-42.");
        }),
      );
      const prepared = yield* prepare(store, first.enricher);
      const entries = [
        { pluginId: "test.p1", item: { title: "Notes", text: "The codename is PERIWINKLE-42." } },
      ];
      expect(prepared).toEqual({ _tag: "ready", entries });
      expect(contextItems(store)).toMatchObject([
        {
          status: "completed",
          title: "Added context from Plugin 1",
          toolSource: { key: "plugin:test.p1", name: "Plugin 1", kind: "integration" },
          input: { plugin: { id: "test.p1", installationId: "installation-1", generation: 1 } },
          output: { context: entries.map((entry) => entry.item) },
        },
      ]);
      expect(store.writes.length).toBe(2);

      // A retried start (worker retry or replay) reads the record and calls nothing.
      const retry = enricherOf([source(1), source(2)], () => Effect.die("must not be called"));
      expect(yield* prepare(store, retry.enricher)).toEqual(prepared);
      expect(retry.calls).toEqual([]);
      expect(store.writes.length).toBe(2);

      expect(withPluginContext("What is the codename?", entries)).toBe(
        '<plugin-context plugin="test.p1" title="Notes">\nThe codename is PERIWINKLE-42.\n</plugin-context>\n\nWhat is the codename?',
      );
    }).pipe(Effect.provide(IdAllocator.layer)),
  );

  it.effect("records a cut-off call as not added and never calls the plugin again", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const called = yield* Deferred.make<void>();
      const hanging = enricherOf([source(1)], () =>
        Deferred.succeed(called, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const fiber = yield* prepare(store, hanging.enricher).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(called);
      // The worker or the process stops while the plugin is still answering.
      yield* Fiber.interrupt(fiber);
      expect(contextItems(store).map((item) => item.status)).toEqual(["running"]);

      const replay = enricherOf([source(1)], () => Effect.die("must not be called"));
      expect(yield* prepare(store, replay.enricher)).toEqual({ _tag: "ready", entries: [] });
      expect(replay.calls).toEqual([]);
      expect(contextItems(store)).toMatchObject([
        {
          status: "failed",
          title: "Context from Plugin 1 not added",
          output: { reason: "The call did not finish before the run's start was retried." },
        },
      ]);
    }).pipe(Effect.provide(IdAllocator.layer)),
  );

  it.effect("fails open: a skipped plugin adds nothing while the others still do", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const { enricher, calls } = enricherOf([source(1), source(2), source(3)], (called) =>
        Effect.succeed(
          called.pluginId === "test.p1"
            ? { _tag: "skipped", reason: "Plugin 1 did not answer within 5 seconds." }
            : called.pluginId === "test.p2"
              ? { _tag: "added", context: [] }
              : added("kept"),
        ),
      );
      expect(yield* prepare(store, enricher)).toEqual({
        _tag: "ready",
        entries: [{ pluginId: "test.p3", item: { title: "Notes", text: "kept" } }],
      });
      expect(calls.toSorted()).toEqual(["test.p1", "test.p2", "test.p3"]);
      expect(
        contextItems(store).map((item) => [item.status, item.title, item.output] as const),
      ).toEqual([
        [
          "failed",
          "Context from Plugin 1 not added",
          { reason: "Plugin 1 did not answer within 5 seconds." },
        ],
        ["completed", "No context from Plugin 2", { context: [] }],
        [
          "completed",
          "Added context from Plugin 3",
          { context: [{ title: "Notes", text: "kept" }] },
        ],
      ]);
    }).pipe(Effect.provide(IdAllocator.layer)),
  );

  it.effect("calls at most eight plugins and records the rest as skipped", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const sources = Array.from({ length: 9 }, (_, index) => source(index + 1));
      const { enricher, calls } = enricherOf(sources, () => Effect.succeed(added("x")));
      const prepared = yield* prepare(store, enricher);
      expect(prepared._tag === "ready" ? prepared.entries.length : -1).toBe(8);
      expect(calls.length).toBe(8);
      expect(contextItems(store).at(-1)).toMatchObject({
        status: "failed",
        input: { plugin: { id: "test.p9" } },
        output: { reason: "At most 8 plugins add context to one run." },
      });
    }).pipe(Effect.provide(IdAllocator.layer)),
  );

  it.effect("stops without saving answers once the run is no longer starting", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const { enricher } = enricherOf([source(1)], () =>
        Effect.sync(() => {
          store.run.status = "interrupted";
          return added("too late");
        }),
      );
      expect(yield* prepare(store, enricher)).toEqual({ _tag: "stale" });
      expect(contextItems(store).map((item) => item.status)).toEqual(["running"]);

      // A run that already moved on is never enriched.
      const moved = makeStore();
      moved.run.status = "running";
      const untouched = enricherOf([source(1)], () => Effect.die("must not be called"));
      expect(yield* prepare(moved, untouched.enricher)).toEqual({ _tag: "stale" });
      expect(untouched.calls).toEqual([]);

      // No plugins: nothing is written.
      const empty = makeStore();
      expect(yield* prepare(empty, enricherOf([], () => Effect.die("none")).enricher)).toEqual({
        _tag: "ready",
        entries: [],
      });
      expect(empty.writes).toEqual([]);
    }).pipe(Effect.provide(IdAllocator.layer)),
  );
});
