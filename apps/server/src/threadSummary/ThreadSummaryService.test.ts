import { assert, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  THREAD_SUMMARY_MODEL,
  THREAD_SUMMARY_PROMPT_VERSION,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect } from "vite-plus/test";

import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { make, resolveThreadSummaryBatchSizes } from "./ThreadSummaryService.ts";

const THREAD_ID = ThreadId.make("thread-summary-test");
const INSTANCE_ID = ProviderInstanceId.make("codex_summary_test");

type GenerateSummary = NonNullable<
  TextGeneration.TextGeneration["Service"]["generateThreadSummary"]
>;

function makeRegistry(
  generateThreadSummary?: GenerateSummary,
): ProviderInstanceRegistry.ProviderInstanceRegistry["Service"] {
  const textGeneration = TextGeneration.TextGeneration.of({
    generateCommitMessage: () => Effect.die("unused commit generation"),
    generatePrContent: () => Effect.die("unused PR generation"),
    generateBranchName: () => Effect.die("unused branch generation"),
    generateThreadTitle: () => Effect.die("unused title generation"),
    ...(generateThreadSummary ? { generateThreadSummary } : {}),
  });
  const driverKind = ProviderDriverKind.make("codex");
  const instance = {
    instanceId: INSTANCE_ID,
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: "codex:summary-test",
    },
    displayName: "Summary test",
    enabled: true,
    snapshot: {} as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration,
  } satisfies ProviderInstance;

  return {
    getInstance: (instanceId) => Effect.succeed(instanceId === INSTANCE_ID ? instance : undefined),
    listInstances: Effect.succeed(generateThreadSummary ? [instance] : []),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.die("unused registry subscription"),
  };
}

const prepareFixture = Effect.fn("prepareThreadSummaryFixture")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 42 });
  yield* sql`DELETE FROM thread_summary_timeline_entries`;
  yield* sql`DELETE FROM projection_turns`;
  yield* sql`DELETE FROM projection_thread_messages`;
  yield* sql`DELETE FROM projection_threads`;
  yield* sql`DELETE FROM projection_projects`;
  yield* sql`
    INSERT INTO projection_projects (
      project_id, title, workspace_root, scripts_json, created_at, updated_at
    ) VALUES (
      'project-summary-test', 'Summary project', '/tmp/summary-project', '[]',
      '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
    )
  `;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, branch, worktree_path, latest_turn_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      ${THREAD_ID}, 'project-summary-test', 'Summary thread', NULL,
      '/tmp/summary-project', NULL, '2026-08-20T00:00:00.000Z',
      '2026-08-20T00:00:00.000Z', NULL
    )
  `;
});

function insertTurns(
  fromTurn: number,
  toTurn: number,
  options: { readonly longMessages?: boolean; readonly reverseFirstAssistants?: boolean } = {},
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (let turn = fromTurn; turn <= toTurn; turn += 1) {
      const suffix = String(turn).padStart(3, "0");
      const turnId = `turn-${suffix}`;
      const userId = `user-${suffix}`;
      const requestedAt = `2026-08-20T01:${suffix.slice(1)}:00.000Z`;
      const completedAt = `2026-08-20T02:${suffix.slice(1)}:00.125Z`;
      const padding = options.longMessages ? "x".repeat(20_000) : "";

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        ) VALUES (
          ${userId}, ${THREAD_ID}, ${turnId}, 'user', ${`User ${turn} ${padding}`}, 0,
          ${requestedAt}, ${requestedAt}
        )
      `;
      if (turn === 1 && options.reverseFirstAssistants) {
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
          ) VALUES (
            'assistant-001-z', ${THREAD_ID}, ${turnId}, 'assistant', 'assistant second', 0,
            '2026-08-20T01:00:03.000Z', '2026-08-20T01:00:03.000Z'
          )
        `;
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
          ) VALUES (
            'assistant-001-a', ${THREAD_ID}, ${turnId}, 'assistant', 'assistant first', 0,
            '2026-08-20T01:00:02.000Z', '2026-08-20T01:00:02.000Z'
          )
        `;
      } else {
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
          ) VALUES (
            ${`assistant-${suffix}`}, ${THREAD_ID}, ${turnId}, 'assistant',
            ${`Assistant ${turn} ${padding}`}, 0, ${completedAt}, ${completedAt}
          )
        `;
      }
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, assistant_message_id, state,
          requested_at, started_at, completed_at, checkpoint_turn_count,
          checkpoint_ref, checkpoint_status, checkpoint_files_json
        ) VALUES (
          ${THREAD_ID}, ${turnId}, ${userId}, NULL, 'completed', ${requestedAt},
          ${requestedAt}, ${completedAt}, NULL, NULL, NULL, '[]'
        )
      `;
    }
  });
}

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

describe("thread summary batching", () => {
  it("summarizes every completed turn on the first open", () => {
    expect(resolveThreadSummaryBatchSizes(13, 0)).toEqual([13]);
  });

  it("appends only complete batches of exactly eight turns", () => {
    expect(resolveThreadSummaryBatchSizes(15, 8)).toEqual([]);
    expect(resolveThreadSummaryBatchSizes(16, 8)).toEqual([8]);
    expect(resolveThreadSummaryBatchSizes(25, 8)).toEqual([8, 8]);
  });
});

layer("ThreadSummaryService", (it) => {
  it.effect("generates with Luna, persists privately, orders messages, and appends at eight", () =>
    Effect.gen(function* () {
      yield* prepareFixture();
      yield* insertTurns(1, 8, { reverseFirstAssistants: true });
      const calls: Parameters<GenerateSummary>[0][] = [];
      const service = yield* make.pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeRegistry((input) => {
            calls.push(input);
            return Effect.succeed({ summary: `Summary ${calls.length}` });
          }),
        ),
      );
      const sql = yield* SqlClient.SqlClient;
      const visibleMessagesBefore = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_thread_messages
      `;

      const initial = yield* service.getTimeline(THREAD_ID);
      assert.equal(initial.entries.length, 1);
      assert.equal(initial.entries[0]?.fromTurn, 1);
      assert.equal(initial.entries[0]?.toTurn, 8);
      assert.equal(initial.entries[0]?.promptVersion, THREAD_SUMMARY_PROMPT_VERSION);
      assert.equal(calls[0]?.modelSelection.model, THREAD_SUMMARY_MODEL);
      assert.deepStrictEqual(calls[0]?.modelSelection.options, [
        { id: "reasoningEffort", value: "low" },
      ]);
      assert.isTrue(
        (calls[0]?.transcript.indexOf("assistant first") ?? -1) <
          (calls[0]?.transcript.indexOf("assistant second") ?? -1),
      );
      const visibleMessagesAfterInitial = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_thread_messages
      `;
      assert.deepStrictEqual(visibleMessagesAfterInitial, visibleMessagesBefore);

      yield* insertTurns(9, 15);
      yield* service.appendDueBatches(THREAD_ID);
      assert.equal(calls.length, 1);
      yield* insertTurns(16, 16);
      yield* service.appendDueBatches(THREAD_ID);
      assert.equal(calls.length, 2);
      const entries = yield* sql<{ readonly from_turn: number; readonly to_turn: number }>`
        SELECT from_turn, to_turn FROM thread_summary_timeline_entries ORDER BY from_turn
      `;
      assert.deepStrictEqual(entries, [
        { from_turn: 1, to_turn: 8 },
        { from_turn: 9, to_turn: 16 },
      ]);
      const expectedVisibleMessages = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_thread_messages
      `;
      const cachedService = yield* make.pipe(
        Effect.provideService(ProviderInstanceRegistry.ProviderInstanceRegistry, makeRegistry()),
      );
      const cached = yield* cachedService.getTimeline(THREAD_ID);
      assert.equal(cached.entries.length, 2);
      const visibleMessagesAfter = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_thread_messages
      `;
      assert.deepStrictEqual(visibleMessagesAfter, expectedVisibleMessages);
    }),
  );

  it.effect("bounds an initial prompt while retaining every turn marker", () =>
    Effect.gen(function* () {
      yield* prepareFixture();
      yield* insertTurns(1, 24, { longMessages: true });
      const calls: Parameters<GenerateSummary>[0][] = [];
      const service = yield* make.pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeRegistry((input) => {
            calls.push(input);
            return Effect.succeed({ summary: "Bounded summary" });
          }),
        ),
      );

      yield* service.getTimeline(THREAD_ID);
      const transcript = calls[0]?.transcript ?? "";
      assert.isTrue(transcript.length <= 120_000);
      for (let turn = 1; turn <= 24; turn += 1) {
        assert.isTrue(transcript.includes(`Turn ${turn} (`));
      }
    }),
  );

  it.effect("serializes invalidation behind generation so stale content cannot reappear", () =>
    Effect.gen(function* () {
      yield* prepareFixture();
      yield* insertTurns(1, 1);
      const generationStarted = yield* Deferred.make<void>();
      const releaseGeneration = yield* Deferred.make<void>();
      const invalidationStarted = yield* Deferred.make<void>();
      const service = yield* make.pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeRegistry(() =>
            Effect.gen(function* () {
              yield* Deferred.succeed(generationStarted, undefined);
              yield* Deferred.await(releaseGeneration);
              return { summary: "Must be invalidated" };
            }),
          ),
        ),
      );

      const generation = yield* Effect.forkChild(service.getTimeline(THREAD_ID));
      yield* Deferred.await(generationStarted);
      const invalidation = yield* Effect.forkChild(
        Deferred.succeed(invalidationStarted, undefined).pipe(
          Effect.andThen(service.invalidate(THREAD_ID)),
        ),
      );
      yield* Deferred.await(invalidationStarted);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseGeneration, undefined);
      yield* Fiber.join(generation);
      yield* Fiber.join(invalidation);

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM thread_summary_timeline_entries
      `;
      assert.equal(rows[0]?.count, 0);
    }),
  );
});
