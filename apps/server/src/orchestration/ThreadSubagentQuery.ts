import {
  OrchestrationThreadActivity,
  ThreadId,
  type OrchestrationSession,
  type ThreadSubagentSummary,
} from "@t3tools/contracts";
import { foldSubagentActivities, isActiveSubagentStatus } from "@t3tools/shared/subagentRuntime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

const ActivityRow = Schema.Struct({
  threadId: ThreadId,
  ...OrchestrationThreadActivity.fields,
  payload: Schema.fromJsonString(Schema.Unknown),
  sequence: Schema.NullOr(Schema.Number),
});

/** Read only task lifecycles, with a bounded cache of compact rosters. Chat
 * traffic does not refold histories or load conversation details for the list. */
export function makeThreadSubagentQuery(sql: SqlClient.SqlClient) {
  const cache = new Map<
    string,
    {
      version: string;
      agents: ReadonlyArray<ThreadSubagentSummary>;
    }
  >();
  const listRows = SqlSchema.findAll({
    Request: Schema.Array(ThreadId),
    Result: ActivityRow,
    execute: (ids) => sql`
      SELECT thread_id AS "threadId", activity_id AS id, tone, kind, summary,
        payload_json AS payload, turn_id AS "turnId", sequence, created_at AS "createdAt"
      FROM projection_thread_activities
      WHERE ${sql.in("thread_id", ids)}
        AND kind IN ('task.started', 'task.progress', 'task.updated', 'task.completed')
      ORDER BY thread_id, sequence, created_at, activity_id
    `,
  });

  return Effect.fn("ThreadSubagentQuery.read")(function* (
    threads: ReadonlyArray<{ id: ThreadId; session: OrchestrationSession | null }>,
  ) {
    const result = new Map<string, ReadonlyArray<ThreadSubagentSummary>>();
    if (threads.length === 0) return result;

    const versions = yield* sql<{
      threadId: ThreadId;
      sequence: number | null;
      count: number;
    }>`
      SELECT thread_id AS "threadId", MAX(sequence) AS sequence, COUNT(*) AS count
      FROM projection_thread_activities
      WHERE ${sql.in(
        "thread_id",
        threads.map((thread) => thread.id),
      )}
        AND kind IN ('task.started', 'task.progress', 'task.updated', 'task.completed')
      GROUP BY thread_id
    `;
    const versionByThread = new Map(
      versions.map((row) => [row.threadId, `${row.sequence}:${row.count}`]),
    );
    // Keep this batch's hits even if later inserts evict them from the LRU.
    const cachedByThread = new Map(threads.map((thread) => [thread.id, cache.get(thread.id)]));
    const stale = threads.filter((thread) => {
      const version = versionByThread.get(thread.id);
      return version !== undefined && cachedByThread.get(thread.id)?.version !== version;
    });
    const activitiesByThread = new Map<string, OrchestrationThreadActivity[]>();
    if (stale.length > 0) {
      const rows = yield* listRows(stale.map((thread) => thread.id));
      for (const row of rows) {
        const activities = activitiesByThread.get(row.threadId) ?? [];
        const { threadId: _, sequence, ...activity } = row;
        activities.push({ ...activity, ...(sequence === null ? {} : { sequence }) });
        activitiesByThread.set(row.threadId, activities);
      }
    }
    for (const thread of threads) {
      const version = versionByThread.get(thread.id);
      if (version === undefined) {
        cache.delete(thread.id);
        continue;
      }
      const previous = cachedByThread.get(thread.id);
      const agents =
        previous?.version === version
          ? previous.agents
          : foldSubagentActivities(activitiesByThread.get(thread.id) ?? [])
              .slice()
              .sort(
                (a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id),
              )
              .map(({ id, title, kind, status, parentAgentId }) => ({
                id,
                title,
                kind,
                status,
                parentAgentId,
              }));
      cache.delete(thread.id);
      cache.set(thread.id, { version, agents });
      if (cache.size > 512) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      const live =
        thread.session !== null &&
        thread.session.status !== "stopped" &&
        thread.session.status !== "interrupted" &&
        thread.session.status !== "error";
      result.set(
        thread.id,
        live
          ? agents
          : agents.map((agent) =>
              isActiveSubagentStatus(agent.status) ? { ...agent, status: "interrupted" } : agent,
            ),
      );
    }
    return result;
  });
}
