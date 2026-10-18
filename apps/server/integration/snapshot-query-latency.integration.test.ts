// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off preferSchemaOverJson:off - Bench seeds projection rows with in-process SQLite and times queries on the wall clock.
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, type OrchestrationThreadDetailWindow } from "@t3tools/contracts";
import { afterAll, assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import { makePerfBenchRecorder, type BenchFixtureSize } from "./perfBench.integration.ts";

/**
 * PLANS.md item 12: snapshot-query-latency. Times ProjectionSnapshotQuery's
 * getShellSnapshot and getThreadDetailSnapshot (full and threadDetailCursor
 * paged) against projection fixtures seeded straight into the harness's
 * SQLite, at the same small/medium/large scales the client fixtures use.
 * Results land as perf-analyzer JSON (surface "server") via the recorder.
 */

// Mirrors FIXTURE_SIZES in packages/perf-analyzer/src/seed.ts.
const FIXTURE_SIZES = {
  small: { threads: 12, messagesPerThread: 20, giantThreadMessages: 60 },
  medium: { threads: 80, messagesPerThread: 25, giantThreadMessages: 200 },
  large: { threads: 400, messagesPerThread: 30, giantThreadMessages: 600 },
} as const satisfies Record<
  BenchFixtureSize,
  { threads: number; messagesPerThread: number; giantThreadMessages: number }
>;

const GIANT_THREAD_ID = ThreadId.make("perf-thread-giant");
const MODEL_SELECTION = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });
/** User turns per page; small's giant thread (30 user turns) still gets 2 pages. */
const PAGE_TURN_LIMIT = 20;
const MEASURED_RUNS = 15;
const PAGED_RUNS = 8;

/** mulberry32, as in seed.ts: deterministic bodies across runs. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "checkpoint relay projector adapter turn receipt worktree pairing tunnel surface thread reactor decider schema socket render frame commit branch review".split(
    " ",
  );

function sentence(rng: () => number, words: number): string {
  const parts: Array<string> = [];
  for (let i = 0; i < words; i++) {
    parts.push(WORDS[Math.floor(rng() * WORDS.length)] ?? "thread");
  }
  const text = parts.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

function messageBody(rng: () => number, index: number, giant: boolean): string {
  const paragraphs: Array<string> = [];
  const count = giant && index % 5 === 0 ? 6 : 1 + Math.floor(rng() * 3);
  for (let p = 0; p < count; p++) paragraphs.push(sentence(rng, 12 + Math.floor(rng() * 25)));
  if (index % 4 === 1) {
    const lines = giant && index % 8 === 1 ? 120 : 15;
    const code: Array<string> = [];
    for (let line = 0; line < lines; line++) {
      code.push(
        `export const ${WORDS[line % WORDS.length]}${line} = compute(${Math.floor(rng() * 1000)});`,
      );
    }
    paragraphs.push("```ts\n" + code.join("\n") + "\n```");
  }
  return paragraphs.join("\n\n");
}

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

/**
 * Seeds projection rows into the harness's migrated database, reusing the
 * row shapes of packages/perf-analyzer/src/seed.ts with one deliberate
 * difference: the giant thread gets one turn per user/assistant message pair
 * (seed.ts collapses each thread to a single turn), because the
 * threadDetailCursor window pages by user-anchored turns and a single-turn
 * thread would always fit one page.
 */
function seedProjectionFixture(input: {
  readonly dbPath: string;
  readonly size: BenchFixtureSize;
  readonly workspaceRoot: string;
}): { readonly giantUserTurns: number } {
  const config = FIXTURE_SIZES[input.size];
  const rng = createRng(0x7e5f);
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const projectId = "perf-project";
  const database = new NodeSqlite.DatabaseSync(input.dbPath, { timeout: 30_000 });
  try {
    database.exec("BEGIN IMMEDIATE");

    database
      .prepare(
        `INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, '[]', ?, ?, NULL)`,
      )
      .run(
        projectId,
        "Perf Fixture",
        input.workspaceRoot,
        MODEL_SELECTION,
        minutesBefore(now, 60 * 24 * 30),
        minutesBefore(now, 1),
      );

    const insertThread = database.prepare(
      `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, latest_user_message_at, pending_approval_count,
        pending_user_input_count, has_actionable_proposed_plan, created_at, updated_at,
        archived_at, deleted_at, settled_override, settled_at, snoozed_until, snoozed_at
      ) VALUES (?, ?, ?, ?, 'full-access', 'default', ?, NULL, ?, ?, 0, 0, 0, ?, ?, NULL, NULL, ?, ?, NULL, NULL)`,
    );
    const insertTurn = database.prepare(
      `INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
        started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
        checkpoint_files_json, source_proposed_plan_thread_id, source_proposed_plan_id
      ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL)`,
    );
    const insertSession = database.prepare(
      `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, 'ready', 'Codex', 'codex', NULL, NULL, 'full-access', NULL, NULL, ?)`,
    );
    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );

    let giantUserTurns = 0;

    const seedThread = (threadId: string, index: number, messages: number) => {
      const giant = threadId === GIANT_THREAD_ID;
      const minutesAgo = 5 + index * 7;
      const updatedAt = minutesBefore(now, minutesAgo);
      const title = sentence(rng, 4 + Math.floor(rng() * 4)).slice(0, -1);
      // The giant thread pages, so it gets one turn per user/assistant pair.
      const turnIdFor = (m: number) =>
        giant ? `${threadId}-turn-${Math.floor(m / 2)}` : `${threadId}-turn`;
      insertThread.run(
        threadId,
        projectId,
        title,
        MODEL_SELECTION,
        index % 3 === 0 ? "main" : `perf/branch-${index}`,
        turnIdFor(messages - 1),
        minutesBefore(now, minutesAgo + 1),
        minutesBefore(now, minutesAgo + 240),
        updatedAt,
        "settled",
        updatedAt,
      );
      insertSession.run(threadId, updatedAt);
      if (!giant) {
        insertTurn.run(
          threadId,
          turnIdFor(0),
          `${threadId}-m${messages - 1}`,
          null,
          minutesBefore(now, minutesAgo + 2),
          minutesBefore(now, minutesAgo + 2),
          updatedAt,
        );
      }
      for (let m = 0; m < messages; m++) {
        const at = minutesBefore(now, minutesAgo + (messages - m));
        if (giant && m % 2 === 0) {
          const assistantAt = minutesBefore(now, minutesAgo + (messages - Math.min(m + 1, messages - 1)));
          insertTurn.run(threadId, turnIdFor(m), `${threadId}-m${m}`, `${threadId}-m${m + 1}`, at, at, assistantAt);
          giantUserTurns++;
        }
        insertMessage.run(
          `${threadId}-m${m}`,
          threadId,
          turnIdFor(m),
          m % 2 === 0 ? "user" : "assistant",
          messageBody(rng, m, giant),
          at,
          at,
        );
      }
    };

    seedThread(GIANT_THREAD_ID, 0, config.giantThreadMessages);
    for (let t = 1; t < config.threads; t++) {
      seedThread(`perf-thread-${t}`, t, config.messagesPerThread);
    }

    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw error;
  } finally {
    database.close();
  }
  return { giantUserTurns: Math.ceil(FIXTURE_SIZES[input.size].giantThreadMessages / 2) };
}

const recorder = makePerfBenchRecorder();

afterAll(async () => {
  await recorder.flush();
});

function withHarness<A, E>(use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness(),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

/** Pages the giant thread oldest-ward through the threadDetailCursor path. */
const walkGiantPages = (harness: OrchestrationIntegrationHarness) =>
  Effect.gen(function* () {
    let pages = 0;
    let messages = 0;
    let cursor: OrchestrationThreadDetailWindow["beforeCursor"] = undefined;
    for (;;) {
      const window: OrchestrationThreadDetailWindow =
        cursor === undefined
          ? { turnLimit: PAGE_TURN_LIMIT }
          : { turnLimit: PAGE_TURN_LIMIT, beforeCursor: cursor };
      const snapshot = yield* harness.snapshotQuery.getThreadDetailSnapshot(
        GIANT_THREAD_ID,
        window,
      );
      assert.isTrue(Option.isSome(snapshot), "giant thread page should resolve");
      if (Option.isNone(snapshot)) break;
      const detail = snapshot.value;
      pages++;
      messages += detail.thread.messages.length;
      const page = detail.page;
      assert.isDefined(page, "windowed reads must carry page metadata");
      if (page === undefined || !page.hasMore || page.beforeCursor === null) break;
      cursor = page.beforeCursor;
    }
    return { pages, messages };
  });

/** Times an effect on the wall clock: warmup runs discarded, one sample per measured run. */
const timeSamples = <A, E>(runs: number, warmup: number, effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    for (let i = 0; i < warmup; i++) yield* effect;
    const samples: Array<number> = [];
    for (let i = 0; i < runs; i++) {
      const startedAt = performance.now();
      yield* effect;
      samples.push(performance.now() - startedAt);
    }
    return samples;
  });

const benchSize = (size: BenchFixtureSize) =>
  withHarness((harness) =>
    Effect.gen(function* () {
      const config = FIXTURE_SIZES[size];
      seedProjectionFixture({
        dbPath: harness.dbPath,
        size,
        workspaceRoot: harness.workspaceDir,
      });

      // Correctness first, so the timings below measure real answers.
      const shell = yield* harness.snapshotQuery.getShellSnapshot();
      assert.equal(shell.projects.length, 1);
      assert.equal(shell.threads.length, config.threads);

      const fullDetail = yield* harness.snapshotQuery.getThreadDetailSnapshot(GIANT_THREAD_ID);
      assert.isTrue(Option.isSome(fullDetail), "giant thread should resolve unwindowed");
      if (Option.isSome(fullDetail)) {
        assert.equal(fullDetail.value.thread.messages.length, config.giantThreadMessages);
        assert.isUndefined(fullDetail.value.page, "full reads carry no page metadata");
      }

      const walk = yield* walkGiantPages(harness);
      assert.equal(walk.messages, config.giantThreadMessages);
      assert.isAbove(walk.pages, 1, "the giant thread should need more than one page");

      recorder.record({
        scenario: "snapshot-query-shell",
        size,
        samplesMs: yield* timeSamples(MEASURED_RUNS, 2, harness.snapshotQuery.getShellSnapshot()),
      });
      recorder.record({
        scenario: "snapshot-query-detail",
        size,
        samplesMs: yield* timeSamples(
          MEASURED_RUNS,
          2,
          harness.snapshotQuery.getThreadDetailSnapshot(GIANT_THREAD_ID),
        ),
      });
      recorder.record({
        scenario: "snapshot-query-detail-paged",
        size,
        samplesMs: yield* timeSamples(PAGED_RUNS, 1, walkGiantPages(harness)),
      });
    }),
  );

it.live("measures snapshot query latency at the small fixture size", () => benchSize("small"));
it.live("measures snapshot query latency at the medium fixture size", () => benchSize("medium"));
it.live("measures snapshot query latency at the large fixture size", () => benchSize("large"));
