// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off globalConsoleInEffect:off - Bench appends a synthetic event backlog and times projection replay on the wall clock; cursor-lag sampling reads projection_state through a second readonly SQLite connection.
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { afterAll, assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { layerConfig as SqlitePersistenceFromConfig } from "../src/persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive } from "../src/persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationEventStore } from "../src/persistence/Services/OrchestrationEventStore.ts";
import {
  ORCHESTRATION_PROJECTOR_NAMES,
  OrchestrationProjectionPipelineLive,
} from "../src/orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "../src/orchestration/Services/ProjectionPipeline.ts";
import { ServerConfig } from "../src/config.ts";

import { makePerfBenchRecorder, type BenchFixtureSize } from "./perfBench.integration.ts";

/**
 * PLANS.md item 13: projection-throughput. Appends a synthetic orchestration
 * event backlog through the sanctioned write path (OrchestrationEventStore
 * .append) and replays it through OrchestrationProjectionPipeline.bootstrap,
 * the exact path a server boot takes when projection cursors trail the event
 * head. Two measurements per size:
 *
 * - projection-throughput: wall ms per full replay (events/sec is
 *   eventCount / wall and gets logged alongside).
 * - projection-cursor-lag: while a replay runs, a readonly second connection
 *   samples projection_state and records how many events the slowest
 *   projector cursor trails the head; each sample is converted to ms of
 *   read-model staleness using that run's own per-event replay cost.
 *
 * Sizes are event counts (~1k / ~3k / ~10k). Completion is awaited on the
 * replay fiber itself (Fiber.join), never on the sampling cadence. Results
 * land as perf-analyzer JSON (surface "server") via the recorder.
 */

interface SizeConfig {
  readonly threads: number;
  readonly turnsPerThread: number;
}

/** Events per size: 1 project.created + threads x (1 + 4 x turns). */
const FIXTURE_SIZES = {
  small: { threads: 12, turnsPerThread: 20 }, // 973 events
  medium: { threads: 25, turnsPerThread: 30 }, // 3,026 events
  large: { threads: 50, turnsPerThread: 50 }, // 10,051 events
} as const satisfies Record<BenchFixtureSize, SizeConfig>;

const MEASURED_RUNS: Record<BenchFixtureSize, number> = { small: 3, medium: 3, large: 2 };
const PROJECTOR_COUNT = Object.keys(ORCHESTRATION_PROJECTOR_NAMES).length;
const PROJECT_ID = ProjectId.make("perf-projection-project");
const MODEL_SELECTION = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);
const SAMPLE_INTERVAL_MS = 10;

function totalEventCount(config: SizeConfig): number {
  return 1 + config.threads * (1 + 4 * config.turnsPerThread);
}

function atSeconds(offset: number): string {
  return new Date(BASE_TIME + offset * 1000).toISOString();
}

type BacklogEvent = Omit<OrchestrationEvent, "sequence">;

/**
 * Builds the deterministic backlog: one project, then per thread one
 * thread.created followed by turns of user message-sent, session-set
 * (running), assistant message-sent, session-set (idle). This is the event
 * mix a real dispatch loop persists (see ProviderRuntimeIngestion), so every
 * hot projector runs: threads (with its refreshThreadShellSummary re-reads),
 * thread-messages, thread-sessions, and thread-turns.
 */
function buildBacklog(size: BenchFixtureSize): ReadonlyArray<BacklogEvent> {
  const config = FIXTURE_SIZES[size];
  const events: Array<BacklogEvent> = [];
  let n = 0;
  const base = (aggregateKind: "project" | "thread", aggregateId: ProjectId | ThreadId) => {
    n += 1;
    return {
      eventId: EventId.make(`evt-${size}-${n}`),
      aggregateKind,
      aggregateId,
      occurredAt: atSeconds(n),
      commandId: CommandId.make(`cmd-${size}-${n}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-${size}-${n}`),
      metadata: {},
    } as const;
  };

  events.push({
    ...base("project", PROJECT_ID),
    type: "project.created",
    payload: {
      projectId: PROJECT_ID,
      title: "Projection Bench Project",
      workspaceRoot: "/tmp/perf-projection-workspace",
      defaultModelSelection: MODEL_SELECTION,
      scripts: [],
      createdAt: atSeconds(n),
      updatedAt: atSeconds(n),
    },
  });

  for (let t = 0; t < config.threads; t++) {
    const threadId = ThreadId.make(`perf-projection-thread-${t}`);
    events.push({
      ...base("thread", threadId),
      type: "thread.created",
      payload: {
        threadId,
        projectId: PROJECT_ID,
        title: `Projection bench thread ${t}`,
        modelSelection: MODEL_SELECTION,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: t % 3 === 0 ? "main" : `perf/branch-${t}`,
        worktreePath: null,
        createdAt: atSeconds(n + 1),
        updatedAt: atSeconds(n + 1),
      },
    });

    for (let turn = 0; turn < config.turnsPerThread; turn++) {
      const turnId = TurnId.make(`${threadId}-turn-${turn}`);
      const session = (status: "running" | "idle", at: string) => ({
        threadId,
        status,
        providerName: "Codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access" as const,
        activeTurnId: status === "running" ? turnId : null,
        lastError: null,
        updatedAt: at,
      });

      events.push({
        ...base("thread", threadId),
        type: "thread.message-sent",
        payload: {
          threadId,
          messageId: MessageId.make(`${turnId}-user`),
          role: "user",
          text: `Please refactor module ${turn} of ${threadId}. Keep the adapter boundary clean, leave orchestration pure, and update the focused tests for the changed behavior.`,
          turnId,
          streaming: false,
          createdAt: atSeconds(n + 1),
          updatedAt: atSeconds(n + 1),
        },
      });
      events.push({
        ...base("thread", threadId),
        type: "thread.session-set",
        payload: { threadId, session: session("running", atSeconds(n + 1)) },
      });
      events.push({
        ...base("thread", threadId),
        type: "thread.message-sent",
        payload: {
          threadId,
          messageId: MessageId.make(`${turnId}-assistant`),
          role: "assistant",
          text: `Refactored module ${turn}: moved the provider quirks behind the adapter, kept the decider pure, and extended the projection assertions.\n\n\`\`\`ts\nexport const module${turn} = defineModule({ pure: true, adapterOwned: ["retry", "framing"] });\n\`\`\``,
          turnId,
          streaming: false,
          createdAt: atSeconds(n + 1),
          updatedAt: atSeconds(n + 1),
        },
      });
      events.push({
        ...base("thread", threadId),
        type: "thread.session-set",
        payload: { threadId, session: session("idle", atSeconds(n + 1)) },
      });
    }
  }

  return events;
}

const recorder = makePerfBenchRecorder();

afterAll(async () => {
  await recorder.flush();
});

/** Pipeline + event store over a file-backed temp SQLite, as in production. */
function makeBenchLayer() {
  return OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(SqlitePersistenceFromConfig),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-projection-bench-" })),
    Layer.provideMerge(NodeServices.layer),
  );
}

const benchSize = (size: BenchFixtureSize) =>
  Effect.gen(function* () {
    const config = FIXTURE_SIZES[size];
    const pipeline = yield* OrchestrationProjectionPipeline;
    const eventStore = yield* OrchestrationEventStore;
    const sql = yield* SqlClient.SqlClient;
    const { dbPath } = yield* ServerConfig;

    // Unmeasured setup: persist the backlog through the event store.
    const events = buildBacklog(size);
    let head = 0;
    for (const event of events) {
      head = (yield* eventStore.append(event)).sequence;
    }
    assert.equal(head, totalEventCount(config));

    const resetProjections = Effect.gen(function* () {
      yield* sql`DELETE FROM projection_pending_approvals`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;
    });

    yield* Effect.acquireUseRelease(
      Effect.sync(() => new NodeSqlite.DatabaseSync(dbPath, { readOnly: true })),
      (lagDatabase) =>
        Effect.gen(function* () {
          const lagStatement = lagDatabase.prepare(
            'SELECT COUNT(*) AS "projectors", MIN(last_applied_sequence) AS "minApplied" FROM projection_state',
          );
          /** Events the slowest projector cursor trails the head; null when the read lost a busy race. */
          const readLagEvents = (): number | null => {
            try {
              const row = lagStatement.get() as
                | { projectors: number; minApplied: number | null }
                | undefined;
              if (row === undefined) return head;
              // A projector with no cursor row yet has applied nothing.
              if (row.projectors < PROJECTOR_COUNT || row.minApplied === null) return head;
              return head - row.minApplied;
            } catch {
              return null;
            }
          };

          /**
           * One replay: reset cursors, bootstrap from 0, sample lag while it
           * runs. bootstrapProjector reads the event stream with the store's
           * default 1,000-event limit, so a single bootstrap pass drains at
           * most 1,000 events per projector; the loop below re-bootstraps
           * from the advanced cursors until every projector reaches the
           * head, which is exactly what consecutive server boots would do.
           * The progress assertion keeps a stalled cursor from looping.
           */
          const replay = Effect.gen(function* () {
            yield* resetProjections;
            let finished = false;
            const timedBootstrap = Effect.gen(function* () {
              const startedAt = performance.now();
              let previousMin = -1;
              for (;;) {
                yield* pipeline.bootstrap;
                const cursorRows = yield* sql<{
                  readonly projectors: number;
                  readonly minApplied: number | null;
                }>`
                  SELECT COUNT(*) AS "projectors", MIN(last_applied_sequence) AS "minApplied"
                  FROM projection_state
                `;
                const cursor = cursorRows[0];
                const minApplied =
                  cursor !== undefined &&
                  cursor.projectors >= PROJECTOR_COUNT &&
                  cursor.minApplied !== null
                    ? cursor.minApplied
                    : 0;
                if (minApplied >= head) break;
                assert.isAbove(
                  minApplied,
                  previousMin,
                  "each bootstrap pass must advance the projection cursor",
                );
                previousMin = minApplied;
              }
              return performance.now() - startedAt;
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  finished = true;
                }),
              ),
            );
            const fiber = yield* Effect.forkScoped(timedBootstrap);
            const lagEventSamples: Array<number> = [];
            while (!finished) {
              const lag = readLagEvents();
              if (lag !== null) lagEventSamples.push(lag);
              // Sampling cadence only (mirrors the harness waitFor poll);
              // completion is decided by Fiber.join below, never by time.
              yield* Effect.sleep(SAMPLE_INTERVAL_MS);
            }
            const wallMs = yield* Fiber.join(fiber);
            return { wallMs, lagEventSamples };
          });

          // Warmup replay doubles as the correctness gate: every projector
          // cursor must land exactly on the event head and the read model
          // must hold the full fixture.
          yield* replay;
          const stateRows = yield* sql<{ readonly lastAppliedSequence: number }>`
            SELECT last_applied_sequence AS "lastAppliedSequence" FROM projection_state
          `;
          assert.equal(stateRows.length, PROJECTOR_COUNT);
          for (const row of stateRows) {
            assert.equal(row.lastAppliedSequence, head);
          }
          const threadCount = yield* sql<{ readonly n: number }>`
            SELECT COUNT(*) AS "n" FROM projection_threads
          `;
          assert.equal(threadCount[0]?.n, config.threads);
          const messageCount = yield* sql<{ readonly n: number }>`
            SELECT COUNT(*) AS "n" FROM projection_thread_messages
          `;
          assert.equal(messageCount[0]?.n, config.threads * config.turnsPerThread * 2);

          const walls: Array<number> = [];
          const lagMsSamples: Array<number> = [];
          for (let run = 0; run < MEASURED_RUNS[size]; run++) {
            const { wallMs, lagEventSamples } = yield* replay;
            walls.push(wallMs);
            const perEventMs = wallMs / head;
            for (const lagEvents of lagEventSamples) {
              lagMsSamples.push(lagEvents * perEventMs);
            }
          }

          const summary = recorder.record({
            scenario: "projection-throughput",
            size,
            samplesMs: walls,
          });
          console.log(
            `[perf-bench] projection-throughput (${size}): ${(head / (summary.p50Ms / 1000)).toFixed(0)} events/sec at p50 over ${head} events`,
          );
          if (lagMsSamples.length > 0) {
            recorder.record({
              scenario: "projection-cursor-lag",
              size,
              samplesMs: lagMsSamples,
            });
          }
        }),
      (lagDatabase) => Effect.sync(() => lagDatabase.close()),
    );
  }).pipe(Effect.provide(makeBenchLayer()));

it.live("measures projection replay throughput at ~1k events", () => benchSize("small"), 300_000);
it.live("measures projection replay throughput at ~3k events", () => benchSize("medium"), 300_000);
it.live("measures projection replay throughput at ~10k events", () => benchSize("large"), 600_000);
