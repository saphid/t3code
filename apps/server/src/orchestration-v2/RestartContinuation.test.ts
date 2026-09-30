import { assert, it } from "@effect/vitest";
import {
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSettings from "../serverSettings.ts";
import {
  continueRestartedRun,
  interruptedRunToContinue,
  restartContinuationRun,
} from "./RestartContinuation.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import * as ProviderRuntimeRecovery from "./ProviderRuntimeRecoveryService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EffectOutbox from "./EffectOutbox.ts";

const threadId = ThreadId.make("thread:restart");
const runId = RunId.make("run:restart");
const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread:restart");
const sessionId = ProviderSessionId.make("session:restart");
const attemptId = RunAttemptId.make("attempt:restart");

function makeProjection() {
  return {
    thread: {
      id: threadId,
      projectId: ProjectId.make("restart-project"),
      providerInstanceId: instanceId,
      archivedAt: null,
      deletedAt: null,
    },
    runs: [
      {
        id: runId,
        ordinal: 1,
        providerInstanceId: instanceId,
        modelSelection: { instanceId, model: "gpt-6" },
        providerThreadId,
        activeAttemptId: attemptId,
        status: "running",
      },
    ],
    providerThreads: [
      {
        id: providerThreadId,
        appThreadId: threadId,
        ownerNodeId: null,
        driver,
        providerInstanceId: instanceId,
        providerSessionId: sessionId,
        nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
        status: "active",
      },
    ],
    providerSessions: [
      { id: sessionId, driver, providerInstanceId: instanceId, status: "running" },
    ],
    providerTurns: [
      {
        id: ProviderTurnId.make("turn:restart"),
        providerThreadId,
        runAttemptId: attemptId,
        status: "running",
      },
    ],
    runtimeRequests: [],
    attempts: [],
    nodes: [],
    subagents: [],
    messages: [],
    turnItems: [],
  } as unknown as OrchestrationV2ThreadProjection;
}

it("requires matching saved native state for an unfinished root run", () => {
  const projection = makeProjection();
  assert.equal(restartContinuationRun(projection)?.id, runId);
  for (const invalid of [
    { ...projection, thread: { ...projection.thread, archivedAt: {} } },
    { ...projection, thread: { ...projection.thread, deletedAt: {} } },
    {
      ...projection,
      thread: { ...projection.thread, providerInstanceId: ProviderInstanceId.make("other") },
    },
    {
      ...projection,
      providerThreads: [{ ...projection.providerThreads[0]!, nativeThreadRef: null }],
    },
    {
      ...projection,
      providerSessions: [
        {
          ...projection.providerSessions[0]!,
          providerInstanceId: ProviderInstanceId.make("other"),
        },
      ],
    },
    { ...projection, providerTurns: [] },
    ...[
      "queued",
      "preparing",
      "starting",
      "waiting",
      "completed",
      "cancelled",
      "failed",
      "interrupted",
    ].map((status) => ({ ...projection, runs: [{ ...projection.runs[0]!, status }] })),
  ])
    assert.isUndefined(restartContinuationRun(invalid as OrchestrationV2ThreadProjection));
});

it("recovers an admitted continuation after another crash before provider start", () => {
  const projection = makeProjection();
  const starting = {
    ...projection,
    runs: [
      {
        ...projection.runs[0]!,
        status: "starting" as const,
        restartContinuationOfRunId: RunId.make("run:previous-crash"),
      },
    ],
    providerThreads: [{ ...projection.providerThreads[0]!, status: "idle" as const }],
    providerSessions: [{ ...projection.providerSessions[0]!, status: "stopped" as const }],
    providerTurns: [],
  };
  assert.equal(restartContinuationRun(starting)?.id, runId);
});

for (const [enabled, projectOverride] of [
  [false, undefined],
  [true, undefined],
  [false, true],
  [true, false],
] as const) {
  it.effect(
    `atomically records restart intent with cancellation when opt-in is ${enabled} and project override is ${projectOverride}`,
    () =>
      Effect.gen(function* () {
        let committed: Parameters<EventSink.EventSinkV2["Service"]["commitCommand"]>[0] | undefined;
        const recovery = yield* ProviderRuntimeRecovery.make.pipe(
          Effect.provide(
            Layer.mergeAll(
              ServerSettings.layerTest({
                continueThreadsAfterServerUpdate: enabled,
                projectSettingsOverrides:
                  projectOverride === undefined
                    ? {}
                    : {
                        [ProjectId.make("restart-project")]: {
                          continueThreadsAfterServerUpdate: projectOverride,
                        },
                      },
              }),
              Layer.mock(ProjectionStore.ProjectionStoreV2)({
                getRecoveryThreadIds: () => Effect.succeed([threadId]),
                getRuntimeRecoveryProjection: () => Effect.succeed(makeProjection()),
              }),
              Layer.mock(EventSink.EventSinkV2)({
                commitCommand: (input) => {
                  committed = input;
                  return Effect.succeed({ committed: true, cancelledEffectCount: 1 } as never);
                },
              }),
              IdAllocator.layer,
              Layer.mock(EffectWorker.OrchestrationEffectWorkerV2)({
                runRecoveryOnce: Effect.succeed(false),
              }),
              Layer.mock(EffectOutbox.EffectOutboxV2)({
                reconcileAfterProcessLoss: Effect.succeed({ requeued: 0, cancelled: 0 }),
              }),
            ),
          ),
        );
        yield* recovery.reconcile("startup");
        assert.isDefined(committed);
        assert.isTrue(
          committed!.events.some(
            (event) => event.type === "run.updated" && event.payload.status === "cancelled",
          ),
        );
        assert.lengthOf(committed!.effects, (projectOverride ?? enabled) ? 1 : 0);
        if (projectOverride ?? enabled)
          assert.deepEqual(committed!.effects[0]?.request, {
            type: "provider-runtime.continue",
            sourceRunId: runId,
          });
      }),
  );
}

it.effect("does not duplicate delivery and yields to newer user work or opt-out", () =>
  Effect.gen(function* () {
    let projection = makeProjection();
    projection = { ...projection, runs: [{ ...projection.runs[0]!, status: "cancelled" }] };
    const commands: Parameters<ThreadManagementService["Service"]["dispatch"]>[0][] = [];
    const threads = Layer.mock(ThreadManagementService)({
      getThreadRecords: () => Effect.succeed(projection),
      dispatch: (command) => {
        commands.push(command);
        if (command.type === "message.dispatch")
          projection = { ...projection, messages: [{ id: command.messageId } as never] };
        return Effect.succeed({} as never);
      },
    });
    const enabled = Layer.merge(
      threads,
      ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
    );
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(Effect.provide(enabled));
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(Effect.provide(enabled));
    assert.lengthOf(commands, 1);
    assert.match(String(commands[0]!.commandId), /run:restart$/);
    if (commands[0]!.type === "message.dispatch")
      assert.equal(commands[0]!.restartContinuationOfRunId, runId);
    projection = {
      ...projection,
      messages: [],
      runs: [
        ...projection.runs,
        {
          ...projection.runs[0]!,
          id: RunId.make("run:user-newer"),
          ordinal: 2,
          status: "completed",
        },
      ],
    };
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(Effect.provide(enabled));
    assert.lengthOf(commands, 1);
    projection = { ...projection, runs: [projection.runs[0]!] };
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(
      Effect.provide(
        Layer.merge(threads, ServerSettings.layerTest({ continueThreadsAfterServerUpdate: false })),
      ),
    );
    assert.lengthOf(commands, 1);
  }),
);

it.effect("does not cancel or resume a run that completes while shutdown intent commits", () =>
  Effect.gen(function* () {
    let projection = makeProjection();
    const commits: Parameters<EventSink.EventSinkV2["Service"]["commitCommand"]>[0][] = [];
    const recovery = yield* ProviderRuntimeRecovery.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getRecoveryThreadIds: () => Effect.succeed([threadId]),
            getRuntimeRecoveryProjection: () => Effect.sync(() => projection),
          }),
          Layer.mock(EventSink.EventSinkV2)({
            writeWithEffects: (input) =>
              Effect.sync(() => {
                assert.lengthOf(input.events, 0);
                assert.equal(input.effects[0]?.request.type, "provider-runtime.continue");
                projection = {
                  ...projection,
                  runs: [{ ...projection.runs[0]!, status: "completed" }],
                };
                return [];
              }),
            commitCommand: (input) =>
              Effect.sync(() => {
                commits.push(input);
                return { committed: true, cancelledEffectCount: 0 } as never;
              }),
          }),
          IdAllocator.layer,
          Layer.mock(EffectWorker.OrchestrationEffectWorkerV2)({
            runRecoveryOnce: Effect.succeed(false),
          }),
          Layer.mock(EffectOutbox.EffectOutboxV2)({
            reconcileAfterProcessLoss: Effect.succeed({ requeued: 0, cancelled: 0 }),
          }),
        ),
      ),
    );
    yield* recovery.prepareForShutdown;
    yield* recovery.reconcile("shutdown");
    assert.isFalse(
      commits.some((commit) => commit.events.some((event) => event.type === "run.updated")),
    );
    let dispatched = false;
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
          Layer.mock(ThreadManagementService)({
            getThreadRecords: () => Effect.succeed(projection),
            dispatch: () =>
              Effect.sync(() => {
                dispatched = true;
                return {} as never;
              }),
          }),
        ),
      ),
    );
    assert.isFalse(dispatched);
  }),
);

const queuedAfter = (projection: OrchestrationV2ThreadProjection, queueHeld: boolean) => ({
  ...projection,
  runs: [
    ...projection.runs,
    {
      ...projection.runs[0]!,
      id: RunId.make("run:queued-after"),
      ordinal: 2,
      status: "queued" as const,
      ...(queueHeld ? { queueHeld } : {}),
    },
  ],
});

it("continues an interrupted run even when saved provider state is unusable", () => {
  const projection = {
    ...makeProjection(),
    providerThreads: [],
    providerSessions: [],
    providerTurns: [],
  } as unknown as OrchestrationV2ThreadProjection;
  assert.isUndefined(restartContinuationRun(projection));
  const interrupted = projection.runs;
  assert.equal(interruptedRunToContinue(projection, interrupted)?.id, runId);
  // Queued work after the interrupted run does not hide it.
  assert.equal(interruptedRunToContinue(queuedAfter(projection, true), interrupted)?.id, runId);
  for (const invalid of [
    { ...projection, thread: { ...projection.thread, archivedAt: {} } },
    {
      ...projection,
      thread: { ...projection.thread, providerInstanceId: ProviderInstanceId.make("other") },
    },
    // Waiting on the user: the request expired with the restart.
    { ...projection, runs: [{ ...projection.runs[0]!, status: "waiting" }] },
    { ...projection, runs: [{ ...projection.runs[0]!, status: "completed" }] },
  ])
    assert.isUndefined(
      interruptedRunToContinue(invalid as OrchestrationV2ThreadProjection, interrupted),
    );
  // Running, but blocked on an unanswered question: answering is the user's move.
  const nodeId = NodeId.make("node:question");
  assert.isUndefined(
    interruptedRunToContinue(
      {
        ...projection,
        nodes: [{ id: nodeId, runId }],
        runtimeRequests: [{ nodeId, status: "pending" }],
      } as unknown as OrchestrationV2ThreadProjection,
      interrupted,
    ),
  );
  // The latest run must be one this reconcile interrupted.
  assert.isUndefined(interruptedRunToContinue(projection, []));
});

it.effect("releases a held queue behind an interrupted run instead of prompting", () =>
  Effect.gen(function* () {
    let projection = queuedAfter(
      {
        ...makeProjection(),
        runs: [{ ...makeProjection().runs[0]!, status: "cancelled" }],
      } as unknown as OrchestrationV2ThreadProjection,
      true,
    );
    const commands: Parameters<ThreadManagementService["Service"]["dispatch"]>[0][] = [];
    const layer = Layer.merge(
      Layer.mock(ThreadManagementService)({
        getThreadRecords: () => Effect.succeed(projection),
        dispatch: (command) => {
          commands.push(command);
          return Effect.succeed({} as never);
        },
      }),
      ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
    );

    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(Effect.provide(layer));
    assert.lengthOf(commands, 1);
    assert.equal(commands[0]!.type, "queue.resume");
    assert.match(
      String(commands[0]!.commandId),
      new RegExp(`^command:restart-queue-resume:${runId}:\\d+$`),
    );

    // Nothing is held any more: no command, and still no automatic prompt.
    projection = queuedAfter(
      {
        ...makeProjection(),
        runs: [{ ...makeProjection().runs[0]!, status: "cancelled" }],
      } as unknown as OrchestrationV2ThreadProjection,
      false,
    );
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(Effect.provide(layer));
    assert.lengthOf(commands, 1);
  }),
);

it.effect("schedules continuation for an interrupted run whose provider state is unusable", () =>
  Effect.gen(function* () {
    let committed: Parameters<EventSink.EventSinkV2["Service"]["commitCommand"]>[0] | undefined;
    const projection = queuedAfter(
      {
        ...makeProjection(),
        providerThreads: [],
        providerSessions: [],
        providerTurns: [],
      } as unknown as OrchestrationV2ThreadProjection,
      false,
    );
    const recovery = yield* ProviderRuntimeRecovery.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getRecoveryThreadIds: () => Effect.succeed([threadId]),
            getRuntimeRecoveryProjection: () => Effect.succeed(projection),
          }),
          Layer.mock(EventSink.EventSinkV2)({
            commitCommand: (input) => {
              committed = input;
              return Effect.succeed({ committed: true, cancelledEffectCount: 0 } as never);
            },
          }),
          IdAllocator.layer,
          Layer.mock(EffectWorker.OrchestrationEffectWorkerV2)({
            runRecoveryOnce: Effect.succeed(false),
          }),
          Layer.mock(EffectOutbox.EffectOutboxV2)({
            reconcileAfterProcessLoss: Effect.succeed({ requeued: 0, cancelled: 0 }),
          }),
        ),
      ),
    );
    yield* recovery.reconcile("startup");
    assert.deepEqual(committed?.effects[0]?.request, {
      type: "provider-runtime.continue",
      sourceRunId: runId,
    });
    // The queue is still held in the same commit; delivery releases it.
    assert.isTrue(
      committed!.events.some(
        (event) =>
          event.type === "run.updated" &&
          event.payload.status === "queued" &&
          event.payload.queueHeld === true,
      ),
    );
  }),
);
