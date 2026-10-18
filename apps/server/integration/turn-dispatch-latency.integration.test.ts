// @effect-diagnostics globalDate:off - Bench times dispatch-to-receipt on the wall clock; command timestamps are a fixed ISO constant.
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  defaultInstanceIdForDriver,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import { afterAll, assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { TurnProcessingQuiescedReceipt } from "../src/orchestration/Services/RuntimeReceiptBus.ts";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import { makePerfBenchRecorder } from "./perfBench.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";

/**
 * PLANS.md item 11: turn-dispatch-latency. Dispatches thread.turn.start
 * against the replay provider adapter and times command-to-terminal-receipt
 * (requested -> turn.processing.quiesced) per dispatch, so the sample covers
 * the whole write path: decider, provider send, runtime ingestion,
 * projection, and the checkpoint reactor. Two shapes: ~20 sequential turns
 * on one thread, and a burst of 5 threads dispatching once each, repeated
 * for sample count. Results land as perf-analyzer JSON (surface "server")
 * via the recorder.
 */

const PROJECT_ID = ProjectId.make("perf-dispatch-project");
const SEQUENTIAL_THREAD_ID = ThreadId.make("perf-dispatch-seq");
const FIXTURE_TURN_ID = "fixture-turn";
const CODEX_PROVIDER = ProviderDriverKind.make("codex");

const WARMUP_TURNS = 2;
const SEQUENTIAL_RUNS = 20;
const BURST_THREADS = 5;
/** Each round is 5 concurrent single dispatches; 4 rounds give 20 samples. */
const BURST_ROUNDS = 4;

function nowIso() {
  return "2026-05-01T00:00:00.000Z";
}

const recorder = makePerfBenchRecorder();

afterAll(async () => {
  await recorder.flush();
});

function withHarness<A, E>(use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: CODEX_PROVIDER }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

/** Minimal replay fixture for one turn: started, one delta, completed. */
function makeTurnResponse(threadId: ThreadId, tag: string): TestTurnResponse {
  const base = (suffix: string) => ({
    eventId: EventId.make(`evt-${tag}-${suffix}`),
    provider: CODEX_PROVIDER,
    createdAt: nowIso(),
    threadId,
    turnId: FIXTURE_TURN_ID,
  });
  return {
    events: [
      { type: "turn.started", ...base("started") },
      { type: "message.delta", ...base("delta"), delta: `Reply ${tag}.\n` },
      { type: "turn.completed", ...base("completed"), status: "completed" },
    ],
  };
}

const createThread = (harness: OrchestrationIntegrationHarness, threadId: ThreadId) => {
  const defaultModel = DEFAULT_MODEL_BY_PROVIDER[CODEX_PROVIDER] ?? DEFAULT_MODEL;
  return harness.engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`cmd-create-${threadId}`),
    threadId,
    projectId: PROJECT_ID,
    title: `Dispatch bench ${threadId}`,
    modelSelection: {
      instanceId: defaultInstanceIdForDriver(CODEX_PROVIDER),
      model: defaultModel,
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: harness.workspaceDir,
    createdAt: nowIso(),
  });
};

/**
 * Dispatches one thread.turn.start and waits for its terminal receipt
 * (turn.processing.quiesced at the matching per-thread turn count),
 * returning the wall time in milliseconds. The replay response must already
 * be queued so only the dispatch-to-receipt window is on the clock.
 */
const timedTurn = (input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly threadId: ThreadId;
  readonly turn: number;
  readonly tag: string;
}) =>
  Effect.gen(function* () {
    const startedAt = performance.now();
    yield* input.harness.engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`cmd-turn-${input.tag}`),
      threadId: input.threadId,
      message: {
        messageId: MessageId.make(`msg-${input.tag}`),
        role: "user",
        text: `Turn ${input.tag}`,
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      createdAt: nowIso(),
    });
    yield* input.harness.waitForReceipt(
      (receipt): receipt is TurnProcessingQuiescedReceipt =>
        receipt.type === "turn.processing.quiesced" &&
        receipt.threadId === input.threadId &&
        receipt.checkpointTurnCount === input.turn,
    );
    return performance.now() - startedAt;
  });

/**
 * Queues the replay response for a thread's next turn. The first turn of a
 * thread races session creation, so it must go through the next-session
 * queue, and only one thread's first turn may be pending at a time (the next
 * session started drains that whole queue).
 */
const queueResponse = (input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly threadId: ThreadId;
  readonly turn: number;
  readonly tag: string;
}) =>
  input.turn === 1
    ? input.harness.adapterHarness!.queueTurnResponseForNextSession(
        makeTurnResponse(input.threadId, input.tag),
      )
    : input.harness.adapterHarness!.queueTurnResponse(
        input.threadId,
        makeTurnResponse(input.threadId, input.tag),
      );

it.live(
  "measures turn dispatch latency sequentially and under a five-thread burst",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const defaultModel = DEFAULT_MODEL_BY_PROVIDER[CODEX_PROVIDER] ?? DEFAULT_MODEL;
        yield* harness.engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-perf-dispatch-project"),
          projectId: PROJECT_ID,
          title: "Dispatch Bench Project",
          workspaceRoot: harness.workspaceDir,
          defaultModelSelection: {
            instanceId: defaultInstanceIdForDriver(CODEX_PROVIDER),
            model: defaultModel,
          },
          createdAt: nowIso(),
        });

        // Sequential: one thread, warmups discarded, one sample per turn.
        yield* createThread(harness, SEQUENTIAL_THREAD_ID);
        const sequentialSamples: Array<number> = [];
        for (let turn = 1; turn <= WARMUP_TURNS + SEQUENTIAL_RUNS; turn++) {
          const tag = `seq-${turn}`;
          yield* queueResponse({ harness, threadId: SEQUENTIAL_THREAD_ID, turn, tag });
          const wallMs = yield* timedTurn({ harness, threadId: SEQUENTIAL_THREAD_ID, turn, tag });
          if (turn > WARMUP_TURNS) sequentialSamples.push(wallMs);
        }
        assert.equal(sequentialSamples.length, SEQUENTIAL_RUNS);
        recorder.record({
          scenario: "turn-dispatch-latency",
          size: "small",
          samplesMs: sequentialSamples,
        });

        yield* harness.drainProviderRuntime;

        // Burst: warm each thread's session one at a time (the next-session
        // queue drains fully into whichever session starts next), then run
        // measured rounds of 5 concurrent single dispatches.
        const burstThreads = Array.from({ length: BURST_THREADS }, (_, index) =>
          ThreadId.make(`perf-dispatch-burst-${index + 1}`),
        );
        for (const threadId of burstThreads) {
          const tag = `${threadId}-warm`;
          yield* createThread(harness, threadId);
          yield* queueResponse({ harness, threadId, turn: 1, tag });
          yield* timedTurn({ harness, threadId, turn: 1, tag });
        }

        const burstSamples: Array<number> = [];
        for (let round = 1; round <= BURST_ROUNDS; round++) {
          const turn = 1 + round;
          for (const threadId of burstThreads) {
            yield* queueResponse({ harness, threadId, turn, tag: `${threadId}-r${round}` });
          }
          const roundSamples = yield* Effect.forEach(
            burstThreads,
            (threadId) => timedTurn({ harness, threadId, turn, tag: `${threadId}-r${round}` }),
            { concurrency: "unbounded" },
          );
          burstSamples.push(...roundSamples);
          yield* harness.drainProviderRuntime;
        }
        assert.equal(burstSamples.length, BURST_THREADS * BURST_ROUNDS);
        recorder.record({
          scenario: "turn-dispatch-burst",
          size: "small",
          samplesMs: burstSamples,
        });
      }),
    ),
  240_000,
);
