import { ThreadId, type OrchestrationSession } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeThreadSubagentQuery } from "./ThreadSubagentQuery.ts";

const threadId = ThreadId.make("subagent-thread");
const session: OrchestrationSession = {
  threadId,
  status: "ready",
  providerName: "codex",
  runtimeMode: "full-access",
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-09-17T00:00:00.000Z",
};

it.layer(SqlitePersistenceMemory)("ThreadSubagentQuery", (it) => {
  it.effect("keeps every roster when a snapshot exceeds the cache capacity", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const read = makeThreadSubagentQuery(sql);
      const threads = Array.from({ length: 514 }, (_, index) => ({
        id: ThreadId.make(`many-${index}`),
        session,
      }));
      yield* sql`INSERT INTO projection_thread_activities ${sql.insert(
        threads.map((thread, index) => ({
          activity_id: `many-agent-${index}`,
          thread_id: thread.id,
          tone: "info",
          kind: "task.started",
          summary: "Agent",
          payload_json: JSON.stringify({ taskId: "child", title: "Child", agentKind: "agent" }),
          sequence: index + 1,
          created_at: "2026-09-17T00:00:00.000Z",
        })),
      )}`;
      yield* read(threads);
      const refreshed = yield* read(threads);
      assert.equal(refreshed.size, threads.length);
      assert.isTrue(threads.every((thread) => refreshed.get(thread.id)?.length === 1));
      yield* sql`DELETE FROM projection_thread_activities WHERE thread_id LIKE 'many-%'`;
    }),
  );

  it.effect(
    "reads persisted agents without thread details and refreshes after completion, resume, revert and session death",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const read = makeThreadSubagentQuery(sql);
        const insert = (id: number, kind: string, payload: Record<string, unknown>) => sql`
        INSERT INTO projection_thread_activities
          (activity_id, thread_id, tone, kind, summary, payload_json, sequence, created_at)
        VALUES (${`subagent-${id}`}, ${threadId}, 'info', ${kind}, 'task',
          ${JSON.stringify(payload)}, ${id}, '2026-09-17T00:00:00.000Z')
      `;
        yield* insert(1, "task.started", { taskId: "agent", title: "Review", agentKind: "agent" });
        yield* insert(2, "task.started", {
          taskId: "shell",
          title: "Build",
          agentKind: "background",
        });
        yield* insert(3, "tool.started", { taskId: "tool", title: "Read" });
        const threads = [{ id: threadId, session }];
        const first = (yield* read(threads)).get(threadId);
        assert.deepEqual(first, [
          {
            id: "agent",
            title: "Review",
            kind: "subagent",
            status: "running",
            parentAgentId: null,
          },
        ]);
        assert.strictEqual((yield* read(threads)).get(threadId), first);

        yield* insert(4, "task.completed", { taskId: "agent", status: "completed" });
        assert.equal((yield* read(threads)).get(threadId)?.[0]?.status, "completed");
        yield* insert(5, "task.updated", { taskId: "agent", status: "running" });
        assert.equal((yield* read(threads)).get(threadId)?.[0]?.status, "running");
        assert.equal(
          (yield* read([{ id: threadId, session: null }])).get(threadId)?.[0]?.status,
          "interrupted",
        );
        assert.equal((yield* read(threads)).get(threadId)?.[0]?.status, "running");

        yield* sql`DELETE FROM projection_thread_activities WHERE thread_id = ${threadId} AND sequence >= 4`;
        assert.equal((yield* read(threads)).get(threadId)?.[0]?.status, "running");
        yield* sql`DELETE FROM projection_thread_activities WHERE thread_id = ${threadId}`;
        assert.equal((yield* read(threads)).get(threadId), undefined);
      }),
  );

  it.effect("batches threads and uses the partial index for lifecycle lookups", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const plan = yield* sql<{ detail: string }>`
        EXPLAIN QUERY PLAN
        SELECT thread_id, MAX(sequence), COUNT(*) FROM projection_thread_activities
        WHERE thread_id IN ('a', 'b')
          AND kind IN ('task.started', 'task.progress', 'task.updated', 'task.completed')
        GROUP BY thread_id
      `;
      assert.isTrue(plan.some((row) => row.detail.includes("idx_thread_subagent_activities")));
      const read = makeThreadSubagentQuery(sql);
      assert.equal((yield* read([])).size, 0);
      assert.equal(
        (yield* read([
          { id: threadId, session },
          { id: ThreadId.make("other"), session: null },
        ])).size,
        0,
      );
    }),
  );
});
