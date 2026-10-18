// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off preferSchemaOverJson:off - Bench seeds projection rows with in-process SQLite and times queries on the wall clock.
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import { makePerfBenchRecorder } from "./perfBench.integration.ts";

/**
 * PLANS.md item 15: search-threads-latency. Times
 * ProjectionSnapshotQuery.searchThreads (the plain LIKE scan behind
 * orchestration.searchThreads, no FTS index) against the large projection
 * fixture (400 threads x 30 messages) for type-ahead query lengths of 1 to 5
 * characters, using prefixes of a deterministic seeded word so every length
 * matches rows. Also times getCommandReadModel plus its JSON payload size:
 * that query is the entire body of GET /api/orchestration/snapshot (see
 * apps/server/src/orchestration/http.ts, whose comment records the OOM risk
 * the lightweight read model avoids); the harness exposes no HTTP server, so
 * the HTTP framing itself is out of scope here. Results land as
 * perf-analyzer JSON (surface "server") via the recorder.
 */

// Mirrors FIXTURE_SIZES.large in packages/perf-analyzer/src/seed.ts.
const LARGE = { threads: 400, messagesPerThread: 30 } as const;

const MODEL_SELECTION = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });
const MEASURED_RUNS = 15;
const READ_MODEL_RUNS = 5;

/**
 * Prefixes of the first seeded vocabulary word. Every length from "c" to
 * "check" matches seeded bodies, and each is a single search term
 * (threadSearchTerms keeps one-word queries whole), so length is the only
 * variable across measurements.
 */
const QUERY_WORD = "check";

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

function messageBody(rng: () => number, index: number): string {
  const paragraphs: Array<string> = [];
  const count = 1 + Math.floor(rng() * 3);
  for (let p = 0; p < count; p++) paragraphs.push(sentence(rng, 12 + Math.floor(rng() * 25)));
  if (index % 4 === 1) {
    const code: Array<string> = [];
    for (let line = 0; line < 15; line++) {
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
 * row shapes of the snapshot-query-latency bench (in turn mirroring
 * packages/perf-analyzer/src/seed.ts) with one deliberate difference: every
 * thread gets one turn per user/assistant message pair with
 * assistant_message_id set, because searchThreads only scans assistant
 * messages that a turn marks canonical. A single null-assistant turn per
 * thread would silently halve the scanned rows.
 */
function seedProjectionFixture(input: {
  readonly dbPath: string;
  readonly workspaceRoot: string;
}): void {
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

    for (let t = 0; t < LARGE.threads; t++) {
      const threadId = `perf-thread-${t}`;
      const messages = LARGE.messagesPerThread;
      const minutesAgo = 5 + t * 7;
      const updatedAt = minutesBefore(now, minutesAgo);
      const title = sentence(rng, 4 + Math.floor(rng() * 4)).slice(0, -1);
      const turnIdFor = (m: number) => `${threadId}-turn-${Math.floor(m / 2)}`;
      insertThread.run(
        threadId,
        projectId,
        title,
        MODEL_SELECTION,
        t % 3 === 0 ? "main" : `perf/branch-${t}`,
        turnIdFor(messages - 1),
        minutesBefore(now, minutesAgo + 1),
        minutesBefore(now, minutesAgo + 240),
        updatedAt,
        "settled",
        updatedAt,
      );
      insertSession.run(threadId, updatedAt);
      for (let m = 0; m < messages; m++) {
        const at = minutesBefore(now, minutesAgo + (messages - m));
        if (m % 2 === 0) {
          const assistantAt = minutesBefore(
            now,
            minutesAgo + (messages - Math.min(m + 1, messages - 1)),
          );
          insertTurn.run(
            threadId,
            turnIdFor(m),
            `${threadId}-m${m}`,
            `${threadId}-m${m + 1}`,
            at,
            at,
            assistantAt,
          );
        }
        insertMessage.run(
          `${threadId}-m${m}`,
          threadId,
          turnIdFor(m),
          m % 2 === 0 ? "user" : "assistant",
          messageBody(rng, m),
          at,
          at,
        );
      }
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

const bench = () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      seedProjectionFixture({ dbPath: harness.dbPath, workspaceRoot: harness.workspaceDir });

      // Correctness first, so the timings below measure real answers.
      const counts = yield* harness.snapshotQuery.getCounts();
      assert.equal(counts.threadCount, LARGE.threads);

      const fullWord = yield* harness.snapshotQuery.searchThreads({ query: QUERY_WORD });
      assert.isAbove(fullWord.matches.length, 0, "the seeded word should match threads");
      assert.isAtMost(fullWord.matches.length, 50, "results respect the default limit");
      assert.isTrue(
        fullWord.matches.every((match) => (match.matchedTerms ?? []).includes(QUERY_WORD)),
        "every match should carry the query term",
      );

      for (let length = 1; length <= QUERY_WORD.length; length++) {
        const query = QUERY_WORD.slice(0, length);
        const result = yield* harness.snapshotQuery.searchThreads({ query });
        assert.isAbove(result.matches.length, 0, `'${query}' should match seeded threads`);
        recorder.record({
          scenario: `search-threads-q${length}`,
          size: "large",
          samplesMs: yield* timeSamples(
            MEASURED_RUNS,
            2,
            harness.snapshotQuery.searchThreads({ query }),
          ),
        });
      }

      // GET /api/orchestration/snapshot's handler body: the lightweight
      // command read model. Wall time here, payload size logged alongside.
      const readModel = yield* harness.snapshotQuery.getCommandReadModel();
      const payloadBytes = Buffer.byteLength(JSON.stringify(readModel), "utf8");
      assert.isAbove(payloadBytes, 0, "the snapshot payload should serialize");
      yield* Effect.log(
        `[perf-bench] orchestration-snapshot-read-model (large): payload ${payloadBytes} bytes`,
      );
      recorder.record({
        scenario: "orchestration-snapshot-read-model",
        size: "large",
        samplesMs: yield* timeSamples(
          READ_MODEL_RUNS,
          1,
          harness.snapshotQuery.getCommandReadModel(),
        ),
      });
    }),
  );

it.live("measures thread search latency per query length at the large fixture size", () =>
  bench(),
);
