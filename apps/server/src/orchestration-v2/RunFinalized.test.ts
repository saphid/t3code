import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  CommandId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2StoredEvent,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as CheckpointCapture from "./CheckpointCaptureService.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as RunFinalization from "./RunFinalizationService.ts";
import { checkpointCaptureEffectId } from "./RunFinalized.ts";

const threadId = ThreadId.make("thread:run-finalized");
const runId = RunId.make("run:run-finalized");
const scopeId = CheckpointScopeId.make("scope:run-finalized");
const rootNodeId = NodeId.make("node:run-finalized-root");
const providerThreadId = ProviderThreadId.make("provider-thread:run-finalized");
const providerInstanceId = ProviderInstanceId.make("codex");
const checkpointId = CheckpointId.make("checkpoint:run-finalized");

const makeLayer = (
  capture: Effect.Effect<void, never, EventSink.EventSinkV2>,
  refresh: () => Effect.Effect<void> = () => Effect.void,
) => {
  const stores = Layer.mergeAll(
    SqlitePersistenceMemory,
    EventStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  );
  const eventSink = EventSink.layer.pipe(Layer.provide(stores));
  const outbox = EffectOutbox.layer.pipe(Layer.provide(SqlitePersistenceMemory));
  const finalization = RunFinalization.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        stores,
        eventSink,
        Layer.effect(
          CheckpointCapture.CheckpointCaptureServiceV2,
          Effect.gen(function* () {
            const sink = yield* EventSink.EventSinkV2;
            return { execute: () => Effect.provideService(capture, EventSink.EventSinkV2, sink) };
          }),
        ).pipe(Layer.provide(eventSink)),
        Layer.succeed(RunFinalization.RunFinalizationObserver, {
          refresh,
          refreshAfterTurn: () => Effect.void,
        }),
      ),
    ),
  );
  return Layer.mergeAll(stores, eventSink, outbox, finalization);
};

const makeRun = (
  now: DateTime.Utc,
  status: OrchestrationV2Run["status"],
  overrides: Partial<OrchestrationV2Run> = {},
): OrchestrationV2Run => ({
  id: runId,
  threadId,
  ordinal: 1,
  providerInstanceId,
  modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
  providerThreadId,
  userMessageId: MessageId.make("message:run-finalized"),
  rootNodeId,
  activeAttemptId: null,
  status,
  requestedAt: now,
  startedAt: now,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
  ...overrides,
});

let eventCounter = 0;
const runEvent = (
  type: "run.created" | "run.updated",
  run: OrchestrationV2Run,
  occurredAt: DateTime.Utc,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:run-finalized-test:${(eventCounter += 1)}`),
  type,
  threadId,
  runId: run.id,
  providerInstanceId,
  occurredAt,
  payload: run,
});

const captureEffect = {
  id: checkpointCaptureEffectId(runId),
  commandId: CommandId.make(`command:effect:checkpoint.capture:${runId}`),
  threadId,
  request: { type: "checkpoint.capture" as const, runId, scopeId },
};

const seedThread = Effect.gen(function* () {
  const eventSink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  yield* eventSink.write({
    events: [
      {
        id: EventId.make("event:run-finalized-test:thread"),
        type: "thread.created",
        threadId,
        providerInstanceId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make("project:run-finalized"),
          title: "Run finalized",
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
      {
        id: EventId.make("event:run-finalized-test:scope"),
        type: "checkpoint-scope.created",
        threadId,
        occurredAt: now,
        payload: {
          id: scopeId,
          threadId,
          runId,
          nodeId: rootNodeId,
          parentScopeId: null,
          providerThreadId,
          kind: "root_run",
          ordinalWithinParent: 0,
          advancesAppRunCount: true,
          cwd: "/repo",
          createdAt: now,
        },
      },
      runEvent("run.created", makeRun(now, "running"), now),
    ],
  });
});

const storedEvents = Effect.gen(function* () {
  const eventStore = yield* EventStore.EventStoreV2;
  return Array.from(yield* eventStore.read({ threadId }).pipe(Stream.runCollect));
});

const finalizedEvents = (events: ReadonlyArray<OrchestrationV2StoredEvent>) =>
  events.flatMap((stored) => (stored.event.type === "run.finalized" ? [stored] : []));

/** Runs the capture effect the way the worker does: claim, finalize, succeed. */
const runCaptureEffect = Effect.gen(function* () {
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const finalization = yield* RunFinalization.RunFinalizationService;
  const claimed = yield* outbox.claimNext({ workerId: "test", leaseDurationMs: 60_000 });
  assert.isTrue(Option.isSome(claimed));
  yield* finalization.finalize({ threadId, runId, scopeId });
  yield* outbox.succeed({ effectId: captureEffect.id, workerId: "test" });
});

/** Stands in for CheckpointCaptureService: commits the checkpoint once, like the real one. */
const commitCapture = (status: "completed" | "interrupted" | "cancelled") =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    yield* eventSink.commitCommand({
      commandId: captureEffect.commandId,
      threadId,
      commandType: "checkpoint.capture",
      acceptedAt: now,
      effects: [],
      events: [
        runEvent("run.updated", makeRun(now, status, { checkpointId, completedAt: now }), now),
      ],
    });
  });

it.effect("finalizes a completed run once, after its checkpoint and workspace refresh", () => {
  const refreshedAtSequence: Array<number> = [];
  let probe: Effect.Effect<void> = Effect.void;
  return Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    yield* seedThread;
    const now = yield* DateTime.now;
    yield* eventSink.writeWithEffects({
      events: [runEvent("run.updated", makeRun(now, "waiting"), now)],
      effects: [captureEffect],
    });
    assert.lengthOf(finalizedEvents(yield* storedEvents), 0);

    probe = eventSink.latestSequence({ threadId }).pipe(
      Effect.map((sequence) => {
        refreshedAtSequence.push(sequence);
      }),
      Effect.orDie,
    );
    yield* runCaptureEffect;

    const events = yield* storedEvents;
    const finalized = finalizedEvents(events);
    assert.lengthOf(finalized, 1);
    const [stored] = finalized;
    assert.deepEqual(stored?.event.payload, { runId, outcome: "completed", checkpointId });
    assert.equal(stored?.event.id, EventId.make(`event:run-finalized:${runId}`));
    const completedAt = events.find(
      (event) => event.event.type === "run.updated" && event.event.payload.status === "completed",
    )?.sequence;
    assert.isDefined(completedAt);
    assert.deepEqual(refreshedAtSequence, [completedAt!]);
    assert.isTrue(stored!.sequence > completedAt!);
  }).pipe(Effect.provide(makeLayer(commitCapture("completed").pipe(Effect.orDie), () => probe)));
});

it.effect("a retried finalization after a crash still records one milestone", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const finalization = yield* RunFinalization.RunFinalizationService;
    yield* seedThread;
    const now = yield* DateTime.now;
    yield* eventSink.writeWithEffects({
      events: [runEvent("run.updated", makeRun(now, "waiting"), now)],
      effects: [captureEffect],
    });
    // The worker crashed after finalizing but before settling the effect, so
    // a restarted worker runs the whole step again.
    yield* runCaptureEffect;
    yield* finalization.finalize({ threadId, runId, scopeId });
    yield* eventSink.write({
      events: [
        runEvent("run.updated", makeRun(now, "completed", { checkpointId, completedAt: now }), now),
      ],
    });
    assert.lengthOf(finalizedEvents(yield* storedEvents), 1);
  }).pipe(
    Effect.provide(
      // The commit command id makes a repeated capture a no-op, as in production.
      makeLayer(commitCapture("completed").pipe(Effect.orDie)),
    ),
  ),
);

it.effect.each(["interrupted", "cancelled"] as const)(
  "a stopped run with a capture finalizes as %s after the capture",
  (status) =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      yield* seedThread;
      const now = yield* DateTime.now;
      yield* eventSink.writeWithEffects({
        events: [runEvent("run.updated", makeRun(now, status, { completedAt: now }), now)],
        effects: [captureEffect],
      });
      assert.lengthOf(finalizedEvents(yield* storedEvents), 0);
      yield* runCaptureEffect;
      const finalized = finalizedEvents(yield* storedEvents);
      assert.deepEqual(
        finalized.map((stored) => stored.event.payload),
        [{ runId, outcome: status, checkpointId }],
      );
    }).pipe(Effect.provide(makeLayer(commitCapture(status).pipe(Effect.orDie)))),
);

it.effect("a run that ends without a capture finalizes in its terminal commit", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    yield* seedThread;
    const now = yield* DateTime.now;
    const failed = makeRun(now, "failed", { completedAt: now });
    const [terminal, milestone] = yield* eventSink.write({
      events: [runEvent("run.updated", failed, now)],
    });
    assert.equal(terminal?.event.type, "run.updated");
    assert.equal(milestone?.event.type, "run.finalized");
    assert.equal(milestone?.commandId, terminal?.commandId);
    // A repeated terminal write and a later update to the finished run add nothing.
    yield* eventSink.write({ events: [runEvent("run.updated", failed, now)] });
    yield* eventSink.write({
      events: [runEvent("run.updated", { ...failed, status: "cancelled" }, now)],
    });
    assert.deepEqual(
      finalizedEvents(yield* storedEvents).map((stored) => stored.event.payload),
      [{ runId, outcome: "failed", checkpointId: null }],
    );
  }).pipe(Effect.provide(makeLayer(Effect.void))),
);

it.effect("unfinished, discarded, and previously finished runs never finalize", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const finalization = yield* RunFinalization.RunFinalizationService;
    yield* seedThread;
    const now = yield* DateTime.now;
    // Waiting on a capture that never ran.
    yield* eventSink.writeWithEffects({
      events: [runEvent("run.updated", makeRun(now, "waiting"), now)],
      effects: [captureEffect],
    });
    assert.lengthOf(finalizedEvents(yield* storedEvents), 0);
    // Rolled back before the capture ran: discarded, and the capture skips it.
    yield* eventSink.write({
      events: [runEvent("run.updated", makeRun(now, "rolled_back", { completedAt: now }), now)],
    });
    yield* finalization.finalize({ threadId, runId, scopeId });
    assert.lengthOf(finalizedEvents(yield* storedEvents), 0);

    // A run that finished before this milestone existed has no event. A later
    // update to it must not invent one.
    const historical = makeRun(now, "completed", {
      id: RunId.make("run:run-finalized-historical"),
      ordinal: 2,
      completedAt: now,
    });
    yield* eventSink.write({ events: [runEvent("run.created", historical, now)] });
    yield* eventSink.write({ events: [runEvent("run.updated", historical, now)] });
    assert.lengthOf(finalizedEvents(yield* storedEvents), 0);
  }).pipe(Effect.provide(makeLayer(Effect.void))),
);

it.effect("a waiting run whose capture gave up finalizes when it is later cancelled", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    yield* seedThread;
    const now = yield* DateTime.now;
    yield* eventSink.writeWithEffects({
      events: [runEvent("run.updated", makeRun(now, "waiting"), now)],
      effects: [captureEffect],
    });
    yield* outbox.claimNext({ workerId: "test", leaseDurationMs: 60_000 });
    yield* outbox.fail({ effectId: captureEffect.id, workerId: "test", error: "capture failed" });
    // Restart recovery cancels a waiting run with no replayable capture.
    yield* eventSink.write({
      commandId: CommandId.make("command:runtime-reconcile:startup:test"),
      events: [
        runEvent(
          "run.updated",
          makeRun(now, "cancelled", { queuePosition: null, completedAt: now }),
          now,
        ),
      ],
    });
    assert.deepEqual(
      finalizedEvents(yield* storedEvents).map((stored) => stored.event.payload),
      [{ runId, outcome: "cancelled", checkpointId: null }],
    );
  }).pipe(Effect.provide(makeLayer(Effect.void))),
);
